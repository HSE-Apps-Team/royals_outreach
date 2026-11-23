import { db } from "@/db";
import { categoryData, clubData, loggedHours, studentClubMembership, studentUserData } from "@/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { getSponsorsByClub } from "@/lib/coordinatorEmails";
import { cancelEmail, emailDisabledReason, sendEmail, type OutgoingEmail } from "@/lib/email";
import { formatDate } from "@/lib/formatDate";
import { getGoalProgressFor } from "@/lib/goalProgress";
import {
  studentClubDecisionEmail,
  studentCoordinatorDecisionEmail,
  studentLogSubmittedEmail,
  type StudentEmailLog,
  type StudentEmailProgress,
} from "@/lib/studentEmailTemplates";

// Emails to students about their own hour requests:
//   - Log submitted: right after they log hours. Hours that need no verification count at
//     once, so that email shows their progress too.
//   - Coordinator decision: right after the coordinator verifies or denies on the coordinator
//     page. When the hours then count (no club step), it shows their progress.
//   - Club decision: when the club approves or denies (Hour Requests, Edit Or Override, Add
//     Hours Manually). It is scheduled in Resend clubEmailDelayMs() ahead (5 minutes), so an
//     Undo, a later change or a delete can cancel it first. Approvals show progress.
//     For testing, CLUB_EMAIL_DELAY_MINUTES=0 sends it right away (Undo can no longer stop it).
//
// Every email comes from the updates@ sender, and replies go to the club's staff sponsors and
// student execs.
//
// These run after the response (next/server's after), so they never slow down or fail the
// action that caused them: problems are logged, not thrown.

const DEFAULT_CLUB_EMAIL_DELAY_MINUTES = 5;

/** How long a club decision email waits before it goes out. CLUB_EMAIL_DELAY_MINUTES overrides it. */
export function clubEmailDelayMs(): number {
  const configured = process.env.CLUB_EMAIL_DELAY_MINUTES;
  const minutes = configured === undefined || configured.trim() === "" ? NaN : Number(configured);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_CLUB_EMAIL_DELAY_MINUTES) * 60 * 1000;
}

// Emails about to go out are left alone when merging, so a cancel never races the send.
const MERGE_MARGIN = sql`now() + interval '1 minute'`;

const FINAL_STATUSES = ["Approved", "Denied"];

// No club email waiting to go out: none yet, or the last one has been sent.
const HAS_NO_WAITING_EMAIL = sql`(${loggedHours.studentEmailId} is null or ${loggedHours.studentEmailSendAt} <= now())`;

const report = (what: string, error: unknown) =>
  console.error(`[student email] ${what}:`, error instanceof Error ? error.message : error);

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

const loadLogs = (nums: number[]) =>
  db
    .select({
      num: loggedHours.num,
      studentId: loggedHours.studentId,
      clubId: loggedHours.clubId,
      categoryId: loggedHours.categoryId,
      status: loggedHours.status,
      opportunityName: loggedHours.opportunityName,
      orgName: loggedHours.orgName,
      date: loggedHours.date,
      hours: loggedHours.hours,
      coordinatorName: loggedHours.coordinatorName,
      coordinatorEmail: loggedHours.coordinatorEmail,
      coordinatorDecision: loggedHours.coordinatorDecision,
      optionalMessage: loggedHours.optionalMessage,
      denyMessage: loggedHours.denyMessage,
      emailId: loggedHours.studentEmailId,
      emailSendAt: loggedHours.studentEmailSendAt,
      hasWaitingEmail: sql<boolean>`not ${HAS_NO_WAITING_EMAIL}`,
      clubName: clubData.clubName,
      categoryName: categoryData.categoryName,
      needsClubConfirmation: categoryData.needsClubConfirmation,
      studentEmail: studentUserData.email,
      fName: studentUserData.fName,
    })
    .from(loggedHours)
    .leftJoin(clubData, eq(clubData.clubId, loggedHours.clubId))
    .leftJoin(categoryData, eq(categoryData.categoryId, loggedHours.categoryId))
    .leftJoin(studentUserData, eq(studentUserData.studentId, loggedHours.studentId))
    .where(inArray(loggedHours.num, nums))
    .orderBy(loggedHours.date, loggedHours.num);

type LogRow = Awaited<ReturnType<typeof loadLogs>>[number];

const loadLog = async (num: number): Promise<LogRow | undefined> => (await loadLogs([num]))[0];

const toEmailLog = (r: LogRow): StudentEmailLog => ({
  opportunity: r.opportunityName ?? "",
  club: r.clubName ?? "your club",
  category: r.categoryName ?? "",
  date: formatDate(r.date),
  hours: r.hours ?? 0,
  organization: r.orgName ?? "",
  coordinatorName: r.coordinatorName ?? "",
  coordinatorEmail: r.coordinatorEmail ?? "",
  message: r.optionalMessage ?? "",
  denyMessage: r.denyMessage ?? "",
});

// The student's progress in each category the rows count toward, in the rows' order.
const progressFor = async (studentId: number, rows: LogRow[]): Promise<StudentEmailProgress[]> => {
  const clubs = await getGoalProgressFor(studentId, { includeInactive: true });
  const seen = new Set<string>();
  const progress: StudentEmailProgress[] = [];
  for (const r of rows) {
    const key = `${r.clubId}:${r.categoryId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const club = clubs.find((c) => c.clubId === r.clubId);
    const category = club?.categories.find((c) => c.categoryId === r.categoryId);
    if (!club || !category) continue;
    progress.push({
      category: category.name,
      club: club.clubName,
      value: category.value,
      goal: category.goal,
      pending: category.pending,
    });
  }
  return progress;
};

// Student execs of the club, who get replies along with the sponsors.
// TODO: once roles are in use, only execs whose role has access to hour requests.
const getExecEmails = async (clubId: number): Promise<string[]> => {
  const rows = await db
    .select({ email: studentUserData.email })
    .from(studentClubMembership)
    .innerJoin(studentUserData, eq(studentUserData.studentId, studentClubMembership.studentId))
    .where(
      and(
        eq(studentClubMembership.clubId, clubId),
        eq(studentClubMembership.is_exec, true),
        sql`coalesce(${studentClubMembership.membership_status}, true)`,
        isNotNull(studentUserData.email),
      ),
    );
  return rows.map((r) => r.email!.trim()).filter(Boolean);
};

// The club's staff sponsors (listed in deny emails) and everyone a reply goes to: the sponsors
// and the student execs, each once, never the student the email is for.
const contactsFor = async (clubId: number | null, studentEmail: string) => {
  if (clubId === null) return { sponsors: [], replyTo: [] };
  const [byClub, execs] = await Promise.all([getSponsorsByClub([clubId]), getExecEmails(clubId)]);
  const sponsors = byClub.get(clubId) ?? [];
  const seen = new Set([studentEmail.toLowerCase()]);
  const replyTo: string[] = [];
  for (const email of [...sponsors.map((s) => s.email), ...execs]) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    replyTo.push(email);
  }
  return { sponsors, replyTo };
};

const fromUpdates = (email: OutgoingEmail, replyTo: string[]): OutgoingEmail => ({
  ...email,
  sender: "updates",
  replyTo,
});

//--------------------------------------------------------------------------------------//
//                                   Sent Right Away                                    //
//--------------------------------------------------------------------------------------//

/** The confirmation after a student logs hours. */
export async function emailLogSubmitted(num: number): Promise<void> {
  if (emailDisabledReason()) return;
  try {
    const r = await loadLog(num);
    if (!r?.studentEmail || r.studentId === null) return;

    const next =
      r.status === "Pending Email Verification"
        ? "coordinator"
        : r.status === "Pending Club Verification"
          ? "club"
          : r.status === "Approved"
            ? null
            : undefined;
    if (next === undefined) return;

    const [progress, { replyTo }] = await Promise.all([
      next === null ? progressFor(r.studentId, [r]) : Promise.resolve([]),
      contactsFor(r.clubId, r.studentEmail),
    ]);
    const email = studentLogSubmittedEmail({
      to: r.studentEmail,
      firstName: r.fName ?? "",
      log: toEmailLog(r),
      next,
      clubReviewsAfter: next === "coordinator" && !!r.needsClubConfirmation,
      progress,
    });

    const result = await sendEmail(fromUpdates(email, replyTo));
    if ("error" in result) report(`log ${num} submitted`, result.error);
  } catch (error) {
    report(`log ${num} submitted`, error);
  }
}

/** The coordinator verified or denied a request on the coordinator page. */
export async function emailCoordinatorDecision(num: number): Promise<void> {
  if (emailDisabledReason()) return;
  try {
    const r = await loadLog(num);
    if (!r?.studentEmail || r.studentId === null) return;

    const approved = r.coordinatorDecision === "Approved";
    // Only while the request still shows that decision
    const matches = approved
      ? r.status === "Approved" || r.status === "Pending Club Verification"
      : r.coordinatorDecision === "Denied" && r.status === "Denied";
    if (!matches) return;

    const counts = r.status === "Approved";
    const [progress, { sponsors, replyTo }] = await Promise.all([
      counts ? progressFor(r.studentId, [r]) : Promise.resolve([]),
      contactsFor(r.clubId, r.studentEmail),
    ]);
    const email = studentCoordinatorDecisionEmail({
      to: r.studentEmail,
      firstName: r.fName ?? "",
      log: toEmailLog(r),
      approved,
      waitingOnClub: r.status === "Pending Club Verification",
      progress,
      sponsors,
    });

    const result = await sendEmail(fromUpdates(email, replyTo));
    if ("error" in result) report(`log ${num} coordinator decision`, result.error);
  } catch (error) {
    report(`log ${num} coordinator decision`, error);
  }
}

//--------------------------------------------------------------------------------------//
//                                Scheduled (Club Review)                               //
//--------------------------------------------------------------------------------------//

// Cancels scheduled emails in Resend and frees their rows. Returns the rows that were in them.
// An email that cannot be cancelled (it already went out) keeps its rows as they are.
const cancelScheduled = async (emailIds: string[]): Promise<number[]> => {
  const freed: number[] = [];
  for (const id of new Set(emailIds)) {
    const result = await cancelEmail(id);
    if ("error" in result) {
      report(`cancel ${id}`, result.error);
      continue;
    }
    const rows = await db
      .update(loggedHours)
      .set({ studentEmailId: null, studentEmailSendAt: null })
      .where(eq(loggedHours.studentEmailId, id))
      .returning({ num: loggedHours.num });
    freed.push(...rows.map((row) => row.num));
  }
  return freed;
};

// One email per student, club and decision, scheduled clubEmailDelayMs() ahead. A student's
// email still waiting in the same club is cancelled and merged in, so several reviews in a
// row become one email. Each row is claimed only if it still has the status the email
// describes, so a change made while this runs cancels that email again.
const scheduleClubEmails = async (nums: number[], depth = 0): Promise<void> => {
  let rows = (await loadLogs(nums)).filter(
    (r) => FINAL_STATUSES.includes(r.status ?? "") && !r.hasWaitingEmail && r.studentEmail && r.clubId !== null,
  );
  if (rows.length === 0) return;

  // Merge with the same students' emails still waiting in the same clubs
  const pairs = new Set(rows.map((r) => `${r.studentId}:${r.clubId}`));
  const waiting = await db
    .select({ studentId: loggedHours.studentId, clubId: loggedHours.clubId, emailId: loggedHours.studentEmailId })
    .from(loggedHours)
    .where(
      and(
        inArray(loggedHours.studentId, [...new Set(rows.map((r) => r.studentId!))]),
        inArray(loggedHours.clubId, [...new Set(rows.map((r) => r.clubId!))]),
        isNotNull(loggedHours.studentEmailId),
        sql`${loggedHours.studentEmailSendAt} > ${MERGE_MARGIN}`,
      ),
    );
  const merge = waiting.filter((w) => pairs.has(`${w.studentId}:${w.clubId}`)).map((w) => w.emailId!);
  if (merge.length > 0) {
    const freed = await cancelScheduled(merge);
    const all = [...new Set([...rows.map((r) => r.num), ...freed])];
    rows = (await loadLogs(all)).filter(
      (r) => FINAL_STATUSES.includes(r.status ?? "") && !r.hasWaitingEmail && r.studentEmail && r.clubId !== null,
    );
  }

  const groups = Map.groupBy(rows, (r) => `${r.studentId}:${r.clubId}:${r.status}`);
  for (const group of groups.values()) {
    const first = group[0];
    const approved = first.status === "Approved";
    const groupNums = group.map((r) => r.num);
    try {
      const [progress, { sponsors, replyTo }] = await Promise.all([
        approved ? progressFor(first.studentId!, group) : Promise.resolve([]),
        contactsFor(first.clubId, first.studentEmail!),
      ]);
      const email = studentClubDecisionEmail({
        to: first.studentEmail!,
        firstName: first.fName ?? "",
        club: first.clubName ?? "Your club",
        approved,
        logs: group.map(toEmailLog),
        progress,
        sponsors,
      });

      // With no delay it goes out now, and its rows count as already sent
      const delay = clubEmailDelayMs();
      const sendAt = new Date(Date.now() + delay);
      const result = await sendEmail(fromUpdates(email, replyTo), delay > 0 ? { scheduledAt: sendAt } : {});
      if ("error" in result) {
        report(`schedule club email for logs ${groupNums.join(", ")}`, result.error);
        continue;
      }

      const claimed = await db
        .update(loggedHours)
        .set({ studentEmailId: result.id, studentEmailSendAt: sendAt })
        .where(
          and(inArray(loggedHours.num, groupNums), eq(loggedHours.status, first.status!), HAS_NO_WAITING_EMAIL),
        )
        .returning({ num: loggedHours.num });

      // Something changed while it was being scheduled: cancel and redo it for what is left
      if (claimed.length < group.length) {
        const freed = await cancelScheduled([result.id]);
        if (freed.length > 0 && depth < 2) await scheduleClubEmails(freed, depth + 1);
      }
    } catch (error) {
      report(`club email for logs ${groupNums.join(", ")}`, error);
    }
  }
};

/**
 * Call after the club changes the status of these rows in any way: approve, deny, undo,
 * Edit Or Override or Add Hours Manually. Cancels their emails still waiting to go out, then
 * schedules what each row's status now calls for (nothing while it is pending again).
 */
export async function updateClubDecisionEmails(nums: number[]): Promise<void> {
  if (nums.length === 0 || emailDisabledReason()) return;
  try {
    const waiting = (await loadLogs(nums)).filter((r) => r.hasWaitingEmail && r.emailId).map((r) => r.emailId!);
    const freed = await cancelScheduled(waiting);
    await scheduleClubEmails([...new Set([...nums, ...freed])]);
  } catch (error) {
    report(`club emails for logs ${nums.join(", ")}`, error);
  }
}

/** Call after deleting rows, with their email ids, so the others in those emails are resent. */
export async function cancelDeletedClubEmails(emailIds: (string | null)[]): Promise<void> {
  const ids = emailIds.filter((id): id is string => !!id);
  if (ids.length === 0 || emailDisabledReason()) return;
  try {
    const freed = await cancelScheduled(ids);
    await scheduleClubEmails(freed);
  } catch (error) {
    report(`club emails after delete`, error);
  }
}
