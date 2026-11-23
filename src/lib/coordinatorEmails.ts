import { db } from "@/db";
import { clubStaffAssignment, loggedHours, staffUserData, studentUserData } from "@/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { coordinatorToken } from "@/lib/coordinatorLink";
import { appUrl, deliveryAddress, emailDisabledReason, inBatches, sendEmailBatch, type OutgoingEmail } from "@/lib/email";
import { coordinatorDigestEmail, type EmailContact } from "@/lib/emailTemplates";
import { formatDate } from "@/lib/formatDate";
import { fullName } from "@/lib/personName";
import { daysBetween, schoolDateOf, schoolToday } from "@/lib/schoolDate";

// Coordinator emails. The job runs at 9am Indiana time every day (src/app/api/cron/daily-emails).
// A coordinator is emailed that morning when either:
//   - a request names them that they have not been told about and that was logged before today
//     (so a request gets its first email at 9am the day after the student logs it), or
//   - they still have requests waiting and their last email was at least a week ago (a reminder).
// Each email lists every request still waiting on them, and marks them all as emailed, so the
// weekly reminders restart from the latest email. Approving or denying a request takes it off
// "Pending Email Verification", which ends its reminders.
// Rows are marked only after Resend accepts their batch, so a failed batch is retried next run.

/** Days between a coordinator's emails while they still have requests waiting. */
export const REMINDER_DAYS = 7;

export type CoordinatorEmailOptions = {
  /** Build the emails without sending or marking anything. */
  dryRun?: boolean;
  /** Only coordinators with a request waiting in this club (the club panel's Send Email Now). */
  clubId?: number;
  /** Email them even when nothing is new since their last email. */
  force?: boolean;
};

export type CoordinatorEmailReport = {
  dryRun: boolean;
  /** Why nothing was sent, when sending is off. */
  disabled: string | null;
  emails: number;
  sent: number;
  errors: string[];
  /** Dry runs only: who would get what, with the address it would really go to. */
  preview?: { to: string; deliveredTo: string; subject: string }[];
};

type Planned = { email: OutgoingEmail; ids: number[] };

const nameOf = (fName: string | null, lName: string | null) =>
  fullName({ fName: fName ?? "", lName: lName ?? "" }) || "A student";

// Staff assigned to each club, as the contacts for questions about its requests.
export const getSponsorsByClub = async (clubIds: number[]): Promise<Map<number, EmailContact[]>> => {
  if (clubIds.length === 0) return new Map();

  const rows = await db
    .select({
      clubId: clubStaffAssignment.clubId,
      email: staffUserData.email,
      fName: staffUserData.fName,
      lName: staffUserData.lName,
    })
    .from(clubStaffAssignment)
    .innerJoin(staffUserData, eq(staffUserData.staffId, clubStaffAssignment.staffId))
    .where(and(inArray(clubStaffAssignment.clubId, clubIds), isNotNull(staffUserData.email)))
    .orderBy(staffUserData.lName, staffUserData.fName);

  const byClub = new Map<number, EmailContact[]>();
  for (const r of rows) {
    if (r.clubId === null || !r.email?.trim()) continue;
    const contact = { name: fullName({ fName: r.fName ?? "", lName: r.lName ?? "" }) || "Club Sponsor", email: r.email.trim() };
    byClub.set(r.clubId, [...(byClub.get(r.clubId) ?? []), contact]);
  }
  return byClub;
};

// Every sponsor of the clubs in one email, each listed once.
const sponsorsFor = (clubIds: (number | null)[], byClub: Map<number, EmailContact[]>) => {
  const seen = new Map<string, EmailContact>();
  for (const clubId of new Set(clubIds)) {
    for (const sponsor of (clubId !== null && byClub.get(clubId)) || []) {
      const key = sponsor.email.toLowerCase();
      if (!seen.has(key)) seen.set(key, sponsor);
    }
  }
  return [...seen.values()];
};

//--------------------------------------------------------------------------------------//
//                                         Plan                                         //
//--------------------------------------------------------------------------------------//

const planEmails = async ({ clubId, force = false }: CoordinatorEmailOptions): Promise<Planned[]> => {
  const rows = await db
    .select({
      num: loggedHours.num,
      clubId: loggedHours.clubId,
      email: sql<string>`lower(${loggedHours.coordinatorEmail})`,
      coordinatorName: loggedHours.coordinatorName,
      orgName: loggedHours.orgName,
      opportunity: loggedHours.opportunityName,
      date: loggedHours.date,
      hours: loggedHours.hours,
      message: loggedHours.optionalMessage,
      emailedAt: loggedHours.coordinatorEmailedAt,
      submittedAt: loggedHours.submittedAt,
      fName: studentUserData.fName,
      lName: studentUserData.lName,
    })
    .from(loggedHours)
    .leftJoin(studentUserData, eq(studentUserData.studentId, loggedHours.studentId))
    .where(and(eq(loggedHours.status, "Pending Email Verification"), isNotNull(loggedHours.coordinatorEmail)))
    .orderBy(loggedHours.date, loggedHours.num);

  const planned: Planned[] = [];
  const today = schoolToday();
  const sponsorsByClub = await getSponsorsByClub([
    ...new Set(rows.map((r) => r.clubId).filter((id): id is number => id !== null)),
  ]);

  // One email per coordinator, listing every request waiting on them in any club
  for (const [email, requests] of Map.groupBy(rows, (r) => r.email)) {
    if (clubId !== undefined && !requests.some((r) => r.clubId === clubId)) continue;
    // New: not yet emailed and logged before today (rows from before submittedAt existed count as old)
    const hasNew = requests.some(
      (r) => r.emailedAt === null && (r.submittedAt === null || schoolDateOf(r.submittedAt) < today),
    );
    const emailedTimes = requests.flatMap((r) => (r.emailedAt ? [r.emailedAt.getTime()] : []));
    const lastEmailed = emailedTimes.length > 0 ? schoolDateOf(new Date(Math.max(...emailedTimes))) : null;
    const reminderDue = lastEmailed !== null && daysBetween(lastEmailed, today) >= REMINDER_DAYS;
    if (!force && !hasNew && !reminderDue) continue;
    const token = coordinatorToken(email);
    if (!token) continue;

    const newest = requests.at(-1)!;
    planned.push({
      ids: requests.map((r) => r.num),
      email: coordinatorDigestEmail({
        to: email,
        coordinatorName: newest.coordinatorName ?? "",
        orgName: newest.orgName ?? "",
        link: `${appUrl()}/coordinator/${token}`,
        reminder: !hasNew && lastEmailed !== null,
        requests: requests.map((r) => ({
          student: nameOf(r.fName, r.lName),
          opportunity: r.opportunity ?? "",
          date: formatDate(r.date),
          hours: r.hours ?? 0,
          message: r.message ?? "",
        })),
        sponsors: sponsorsFor(
          requests.map((r) => r.clubId),
          sponsorsByClub,
        ),
      }),
    });
  }

  return planned;
};

//--------------------------------------------------------------------------------------//
//                                         Send                                         //
//--------------------------------------------------------------------------------------//

export async function sendCoordinatorEmails(options: CoordinatorEmailOptions = {}): Promise<CoordinatorEmailReport> {
  // Without a link secret no coordinator can be given a working link, so nobody would be emailed
  if (coordinatorToken("check@example.com") === null) {
    return {
      dryRun: true,
      disabled: "COORDINATOR_LINK_SECRET is not set.",
      emails: 0,
      sent: 0,
      errors: ["COORDINATOR_LINK_SECRET is not set, so no coordinator links can be made."],
    };
  }

  const planned = await planEmails(options);
  const disabled = emailDisabledReason();
  const report: CoordinatorEmailReport = {
    dryRun: !!options.dryRun || disabled !== null,
    disabled,
    emails: planned.length,
    sent: 0,
    errors: [],
  };

  if (report.dryRun) {
    report.preview = planned.map(({ email }) => ({
      to: email.to,
      deliveredTo: deliveryAddress(email.to),
      subject: email.subject,
    }));
    return report;
  }

  for (const batch of inBatches(planned)) {
    const result = await sendEmailBatch(batch.map((p) => p.email));
    if ("error" in result) {
      report.errors.push(result.error);
      continue;
    }
    report.sent += result.sent;
    await db
      .update(loggedHours)
      .set({ coordinatorEmailedAt: new Date() })
      .where(inArray(loggedHours.num, batch.flatMap((p) => p.ids)));
  }

  return report;
}
