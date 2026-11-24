import { db } from "@/db";
import {
  additionalHours,
  categoryClubGroupAssignment,
  categoryData,
  clubData,
  clubMemberGroups,
  clubStaffAssignment,
  loggedHours,
  staffUserData,
  studentClubGroupAssignment,
  studentClubMembership,
  studentUserData,
} from "@/db/schema";
import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { REMINDER_DAYS } from "@/lib/coordinatorEmails";
import { appUrl, deliveryAddress, emailDisabledReason, sendEmail } from "@/lib/email";
import { fullName } from "@/lib/personName";
import { daysBetween, schoolDateOf, schoolMoment, schoolToday } from "@/lib/schoolDate";
import { staffWeeklySummaryEmail, type StaffWeeklySummary } from "@/lib/staffEmailTemplates";

// The Monday summary for staff sponsors: one email per sponsor per club they are assigned to,
// covering the last full week (Monday through Sunday), what is still waiting, and how the
// club's members are doing on their goals.
//
// The cron (src/app/api/cron/weekly-staff) sends them in the 6am hour Indiana time on Mondays
// (on the Hobby plan a run can start anywhere in the hour). Each email's idempotency key names
// the sponsor, club and week, so a repeated run that week does not send it twice.

const COORDINATOR_OVERDUE_DAYS = 7;
// Requests listed under Waiting On Coordinators; the rest are counted.
const COORDINATOR_LIST_LIMIT = 25;

export type StaffSummaryOptions = {
  /** Build the emails without sending anything. */
  dryRun?: boolean;
  /** Send again even if this week's was already sent (testing). */
  now?: boolean;
  /** Only this club. */
  clubId?: number;
};

export type StaffSummaryReport = {
  dryRun: boolean;
  disabled: string | null;
  emails: number;
  sent: number;
  errors: string[];
  preview?: { to: string; deliveredTo: string; subject: string }[];
};

const roundHours = (hours: number) => Math.round(hours * 100) / 100;

const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

// Coordinator emails sent about a request so far, worked out from the schedule rather than
// stored: the first at 9am the day after it was logged, then a reminder every REMINDER_DAYS.
// Summaries go out before 9am, so today's email (if any) has not gone out yet. Only used once
// the request has been emailed at least once (manual sends while the site gate is on can make
// the real number differ).
const COORDINATOR_EMAIL_HOUR = 9;
const coordinatorEmailsSoFar = (loggedOn: string, today: string) => {
  const firstEmailDay = new Date(Date.parse(loggedOn) + 86_400_000).toISOString().slice(0, 10);
  const pastNine =
    Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Indiana/Indianapolis", hour: "numeric", hourCycle: "h23" }).format(
        new Date(),
      ),
    ) >= COORDINATOR_EMAIL_HOUR;
  // Days of emails that have already happened, counting today only once 9am has passed
  const days = daysBetween(firstEmailDay, today) - (pastNine ? 0 : 1);
  return days < 0 ? 1 : Math.floor(days / REMINDER_DAYS) + 1;
};

const nameOf = (fName: string | null, lName: string | null) =>
  fullName({ fName: fName ?? "", lName: lName ?? "" }) || "A student";

//--------------------------------------------------------------------------------------//
//                                       Summary                                        //
//--------------------------------------------------------------------------------------//

type Week = { start: Date; end: Date; firstDay: string; lastDay: string; today: string };

// The last full week before today, Monday through Sunday when run on a Monday.
const lastWeek = (): Week => {
  const today = schoolToday();
  const firstDay = addDays(today, -7);
  return {
    start: schoolMoment(firstDay, 0, 0),
    end: schoolMoment(today, 0, 0),
    firstDay,
    lastDay: addDays(today, -1),
    today,
  };
};

const summarizeClub = async (
  club: { clubId: number; clubName: string; execNeedsHours: boolean | null },
  week: Week,
): Promise<StaffWeeklySummary> => {
  const { clubId } = club;
  const inClub = eq(loggedHours.clubId, clubId);
  const submittedLastWeek = and(inClub, gte(loggedHours.submittedAt, week.start), lt(loggedHours.submittedAt, week.end));
  const decidedLastWeek = and(inClub, gte(loggedHours.decidedAt, week.start), lt(loggedHours.decidedAt, week.end));

  const [members, categories, groupLinks, approvedLogged, approvedAdded, submitted, decided, waiting, top, onCoordinators] =
    await Promise.all([
      db
        .select({ studentId: studentClubMembership.studentId, isExec: studentClubMembership.is_exec })
        .from(studentClubMembership)
        .where(
          and(eq(studentClubMembership.clubId, clubId), sql`coalesce(${studentClubMembership.membership_status}, true)`),
        ),
      db.select().from(categoryData).where(eq(categoryData.clubId, clubId)).orderBy(categoryData.categoryId),
      // One row per group category, or a null category for a group with none
      db
        .select({ studentId: studentClubGroupAssignment.studentId, categoryId: categoryClubGroupAssignment.categoryId })
        .from(studentClubGroupAssignment)
        .innerJoin(clubMemberGroups, eq(clubMemberGroups.groupId, studentClubGroupAssignment.groupId))
        .leftJoin(categoryClubGroupAssignment, eq(categoryClubGroupAssignment.groupId, clubMemberGroups.groupId))
        .where(eq(clubMemberGroups.clubId, clubId)),
      db
        .select({
          studentId: loggedHours.studentId,
          categoryId: loggedHours.categoryId,
          hours: sql<number>`coalesce(sum(${loggedHours.hours}), 0)`.mapWith(Number),
        })
        .from(loggedHours)
        .where(and(inClub, eq(loggedHours.status, "Approved")))
        .groupBy(loggedHours.studentId, loggedHours.categoryId),
      db
        .select({
          studentId: additionalHours.studentId,
          categoryId: additionalHours.categoryId,
          hours: sql<number>`coalesce(sum(${additionalHours.hours}), 0)`.mapWith(Number),
        })
        .from(additionalHours)
        .where(eq(additionalHours.clubId, clubId))
        .groupBy(additionalHours.studentId, additionalHours.categoryId),
      db
        .select({
          requests: sql<number>`count(*)`.mapWith(Number),
          hours: sql<number>`coalesce(sum(${loggedHours.hours}), 0)`.mapWith(Number),
          students: sql<number>`count(distinct ${loggedHours.studentId})`.mapWith(Number),
        })
        .from(loggedHours)
        .where(submittedLastWeek),
      db
        .select({
          status: loggedHours.status,
          requests: sql<number>`count(*)`.mapWith(Number),
          hours: sql<number>`coalesce(sum(${loggedHours.hours}), 0)`.mapWith(Number),
        })
        .from(loggedHours)
        .where(and(decidedLastWeek, inArray(loggedHours.status, ["Approved", "Denied"])))
        .groupBy(loggedHours.status),
      db
        .select({
          status: loggedHours.status,
          requests: sql<number>`count(*)`.mapWith(Number),
          // When each request started waiting on its current step
          oldest: sql<Date | null>`min(coalesce(${loggedHours.coordinatorDecidedAt}, ${loggedHours.submittedAt}))`.mapWith(
            (value) => (value ? new Date(value) : null),
          ),
          overdue: sql<number>`count(*) filter (where ${loggedHours.submittedAt} < now() - make_interval(days => ${COORDINATOR_OVERDUE_DAYS}))`.mapWith(
            Number,
          ),
        })
        .from(loggedHours)
        .where(and(inClub, inArray(loggedHours.status, ["Pending Club Verification", "Pending Email Verification"])))
        .groupBy(loggedHours.status),
      db
        .select({
          fName: studentUserData.fName,
          lName: studentUserData.lName,
          hours: sql<number>`sum(${loggedHours.hours})`.mapWith(Number),
        })
        .from(loggedHours)
        .innerJoin(studentUserData, eq(studentUserData.studentId, loggedHours.studentId))
        .where(and(decidedLastWeek, eq(loggedHours.status, "Approved")))
        .groupBy(loggedHours.studentId, studentUserData.fName, studentUserData.lName)
        .orderBy(sql`sum(${loggedHours.hours}) desc`)
        .limit(5),
      // Each request waiting on a coordinator, oldest first
      db
        .select({
          fName: studentUserData.fName,
          lName: studentUserData.lName,
          opportunity: loggedHours.opportunityName,
          organization: loggedHours.orgName,
          coordinatorName: loggedHours.coordinatorName,
          coordinatorEmail: loggedHours.coordinatorEmail,
          submittedAt: loggedHours.submittedAt,
          date: loggedHours.date,
          emailedAt: loggedHours.coordinatorEmailedAt,
        })
        .from(loggedHours)
        .leftJoin(studentUserData, eq(studentUserData.studentId, loggedHours.studentId))
        .where(and(inClub, eq(loggedHours.status, "Pending Email Verification")))
        .orderBy(sql`${loggedHours.submittedAt} asc nulls first`, loggedHours.num),
    ]);

  // Approved hours by student and category, logged and added together
  const approved = new Map<string, number>();
  for (const r of [...approvedLogged, ...approvedAdded]) {
    const key = `${r.studentId}:${r.categoryId}`;
    approved.set(key, (approved.get(key) ?? 0) + r.hours);
  }

  // Each member's categories: their groups' categories, or every category with no group
  const linksByStudent = Map.groupBy(groupLinks, (l) => l.studentId);
  const categoriesOf = (studentId: number) => {
    const links = linksByStudent.get(studentId);
    if (!links) return categories;
    const ids = new Set(links.map((l) => l.categoryId));
    return categories.filter((c) => ids.has(c.categoryId));
  };

  // Execs in a club where they do not need hours are left out of the goal numbers
  const counted = members.filter(
    (m): m is { studentId: number; isExec: boolean | null } =>
      m.studentId !== null && !(m.isExec && club.execNeedsHours === false),
  );

  const categoryStats = categories.map((c) => ({ name: c.categoryName ?? "", goal: c.goal ?? 0, members: 0, met: 0, percentTotal: 0 }));
  let metAll = 0;
  let noHours = 0;
  for (const m of counted) {
    const mine = categoriesOf(m.studentId);
    const withGoal = mine.filter((c) => (c.goal ?? 0) > 0);
    let total = 0;
    let allMet = withGoal.length > 0;
    for (const c of mine) {
      const value = approved.get(`${m.studentId}:${c.categoryId}`) ?? 0;
      total += value;
      const stats = categoryStats[categories.indexOf(c)];
      stats.members += 1;
      if ((c.goal ?? 0) > 0) {
        stats.percentTotal += Math.min(1, value / c.goal!);
        if (value >= c.goal!) stats.met += 1;
        else allMet = false;
      }
    }
    // Hours logged outside any category (a club with none) still count as hours
    if (mine.length === 0) total = approved.get(`${m.studentId}:null`) ?? 0;
    if (allMet) metAll += 1;
    if (total === 0) noHours += 1;
  }

  const byStatus = (rows: { status: string | null }[], status: string) => rows.find((r) => r.status === status);
  const waitingClub = byStatus(waiting, "Pending Club Verification") as (typeof waiting)[number] | undefined;
  const waitingCoordinator = byStatus(waiting, "Pending Email Verification") as (typeof waiting)[number] | undefined;
  const approvedRow = byStatus(decided, "Approved") as (typeof decided)[number] | undefined;
  const deniedRow = byStatus(decided, "Denied") as (typeof decided)[number] | undefined;

  return {
    clubName: club.clubName,
    firstDay: week.firstDay,
    lastDay: week.lastDay,
    week: {
      submitted: submitted[0]?.requests ?? 0,
      submittedHours: roundHours(submitted[0]?.hours ?? 0),
      studentsLogging: submitted[0]?.students ?? 0,
      approved: approvedRow?.requests ?? 0,
      approvedHours: roundHours(approvedRow?.hours ?? 0),
      denied: deniedRow?.requests ?? 0,
    },
    waiting: {
      club: waitingClub?.requests ?? 0,
      clubOldestDays: waitingClub?.oldest ? daysBetween(schoolDateOf(waitingClub.oldest), week.today) : null,
      coordinator: waitingCoordinator?.requests ?? 0,
      coordinatorOverdue: waitingCoordinator?.overdue ?? 0,
    },
    members: {
      active: members.length,
      counted: counted.length,
      metAllGoals: metAll,
      noHours,
      hasGoals: categories.some((c) => (c.goal ?? 0) > 0),
    },
    categories: categoryStats
      .filter((c) => c.members > 0)
      .map((c) => ({
        name: c.name,
        goal: c.goal,
        members: c.members,
        met: c.met,
        averagePercent: c.goal > 0 ? Math.round((c.percentTotal / c.members) * 100) : null,
      })),
    topStudents: top.map((t) => ({ name: nameOf(t.fName, t.lName), hours: roundHours(t.hours) })),
    coordinatorRequests: onCoordinators.slice(0, COORDINATOR_LIST_LIMIT).map((r) => {
      // Rows logged before submitted_at existed fall back to the volunteer date
      const loggedOn = r.submittedAt ? schoolDateOf(r.submittedAt) : (r.date ?? week.today);
      return {
        student: nameOf(r.fName, r.lName),
        opportunity: r.opportunity ?? "",
        organization: r.organization ?? "",
        coordinatorName: r.coordinatorName ?? "",
        coordinatorEmail: r.coordinatorEmail ?? "",
        loggedOn,
        daysWaiting: Math.max(0, daysBetween(loggedOn, week.today)),
        emailsSent: r.emailedAt ? coordinatorEmailsSoFar(loggedOn, week.today) : 0,
      };
    }),
    moreCoordinatorRequests: Math.max(0, onCoordinators.length - COORDINATOR_LIST_LIMIT),
    links: {
      requests: `${appUrl()}/club/${clubId}/requests`,
      progress: `${appUrl()}/club/${clubId}/progress`,
    },
  };
};

//--------------------------------------------------------------------------------------//
//                                         Send                                         //
//--------------------------------------------------------------------------------------//

export async function sendStaffWeeklySummaries(options: StaffSummaryOptions = {}): Promise<StaffSummaryReport> {
  const week = lastWeek();

  const assignments = await db
    .select({
      clubId: clubData.clubId,
      clubName: clubData.clubName,
      execNeedsHours: clubData.execNeedsHours,
      email: staffUserData.email,
      fName: staffUserData.fName,
    })
    .from(clubStaffAssignment)
    .innerJoin(clubData, eq(clubData.clubId, clubStaffAssignment.clubId))
    .innerJoin(staffUserData, eq(staffUserData.staffId, clubStaffAssignment.staffId))
    .where(
      and(
        eq(clubData.isDeleted, false),
        isNotNull(staffUserData.email),
        options.clubId === undefined ? undefined : eq(clubData.clubId, options.clubId),
      ),
    )
    .orderBy(clubData.clubName);

  const disabled = emailDisabledReason();
  const report: StaffSummaryReport = {
    dryRun: !!options.dryRun || disabled !== null,
    disabled,
    emails: 0,
    sent: 0,
    errors: [],
  };

  for (const [clubId, staff] of Map.groupBy(assignments, (a) => a.clubId)) {
    const first = staff[0];
    let summary: StaffWeeklySummary;
    try {
      summary = await summarizeClub({ clubId, clubName: first.clubName ?? "Your club", execNeedsHours: first.execNeedsHours }, week);
    } catch (error) {
      report.errors.push(`Club ${clubId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    // Each sponsor once, even if assigned twice
    const recipients = [...new Map(staff.map((s) => [s.email!.trim().toLowerCase(), s])).values()];
    for (const person of recipients) {
      const email = {
        ...staffWeeklySummaryEmail({ to: person.email!.trim(), firstName: person.fName ?? "", summary }),
        sender: "updates" as const,
      };
      report.emails += 1;

      if (report.dryRun) {
        (report.preview ??= []).push({ to: email.to, deliveredTo: deliveryAddress(email.to), subject: email.subject });
        continue;
      }

      // Once per sponsor, club and week; a test send (now) is new every time
      const key = `staff-weekly/${clubId}/${email.to.toLowerCase()}/${week.today}`;
      const result = await sendEmail(email, { idempotencyKey: options.now ? `${key}/${Date.now()}` : key });
      if ("error" in result) report.errors.push(`${clubId} → ${email.to}: ${result.error}`);
      else report.sent += 1;
    }
  }

  return report;
}
