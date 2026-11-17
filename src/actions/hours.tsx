"use server";

import { db } from "@/db";
import {
  additionalHours,
  categoryClubGroupAssignment,
  categoryData,
  clubData,
  clubMemberGroups,
  loggedHours,
  studentClubGroupAssignment,
  studentClubMembership,
} from "@/db/schema";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import type { HourRequest, HourRequestStatus } from "@/app/components/requestRow";
import { CURRENT_STUDENT_ID } from "@/lib/currentStudent";
import { formatDate } from "@/lib/formatDate";
import { schoolToday } from "@/lib/schoolDate";
import { cleanLoggedHours, validateLoggedHours, type LoggedHoursFields } from "@/lib/validateLoggedHours";

export type LogHoursCategory = {
  categoryId: number;
  categoryName: string;
  needsEmailVerification: boolean;
  needsClubConfirmation: boolean;
};

/** A club the student can log hours in, with only the categories open to them. */
export type LogHoursClub = {
  clubId: number;
  clubName: string;
  categories: LogHoursCategory[];
};

export type LogHoursInput = LoggedHoursFields & {
  clubId: number;
  categoryId: number;
};

/** A request on My Requests, with what the edit form needs. */
export type MyRequest = HourRequest & {
  id: number;
  clubId: number | null;
  categoryId: number | null;
  /** ISO date, e.g. "2026-10-10". */
  isoDate: string;
  /** True until a coordinator or the club has verified it. */
  canChange: boolean;
};

/** One club on Goal Progress. Every club has at least one category (General Hours if nothing else). */
export type ClubGoalProgress = {
  clubId: number;
  clubName: string;
  /** Approved hours toward the goal, each category counted up to its own goal. */
  earned: number;
  goal: number;
  pending: number;
  /** Value is approved hours; pending is hours still waiting on verification. */
  categories: { name: string; value: number; goal: number; pending: number }[];
  /** An exec in a club where execs do not need hours. */
  noHoursNeeded: boolean;
  isExec: boolean;
  /** Always true for the student's own pages; Look Up Students also lists inactive memberships. */
  isActive: boolean;
  /** Hours the club added for the student (no log row), already counted in the categories. */
  added: number;
};

type ClubsOptions = { includeInactive?: boolean };

export type MyRequestResult = { success: true } | { success: false; error: string };

const ALREADY_VERIFIED = "This request has already been verified, so it can no longer be changed.";

// Email verification comes before the club's, so a request waiting on the club that has a
// coordinator was already verified by them. Reads and writes share this so they cannot disagree.
const IS_UNVERIFIED = sql`(
  ${loggedHours.status} = 'Pending Email Verification'
  or (${loggedHours.status} = 'Pending Club Verification' and ${loggedHours.coordinatorEmail} is null)
)`;

//--------------------------------------------------------------------------------------//
//                                   Other Functions                                   //
//--------------------------------------------------------------------------------------//

// The coordinator's email check comes first, then the club's; with neither, hours count right away.
// Sums of tenth and quarter hours drift in floating point (0.1 + 0.2), so totals keep two places
const roundHours = (hours: number) => Math.round(hours * 100) / 100;

const statusFor = (category: LogHoursCategory): HourRequestStatus => {
  if (category.needsEmailVerification) return "Pending Email Verification";
  if (category.needsClubConfirmation) return "Pending Club Verification";
  return "Approved";
};

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

// A student's active clubs (inactive ones too with includeInactive). A student in a member
// group gets that group's categories; a student with no group gets every category in the club.
const getClubsFor = async (studentId: number, { includeInactive = false }: ClubsOptions = {}) => {
  const clubs = await db
    .select({
      clubId: clubData.clubId,
      clubName: clubData.clubName,
      execNeedsHours: clubData.execNeedsHours,
      isExec: studentClubMembership.is_exec,
      isActive: sql<boolean>`coalesce(${studentClubMembership.membership_status}, true)`,
    })
    .from(studentClubMembership)
    .innerJoin(clubData, eq(clubData.clubId, studentClubMembership.clubId))
    .where(
      and(
        eq(studentClubMembership.studentId, studentId),
        includeInactive ? undefined : sql`coalesce(${studentClubMembership.membership_status}, true)`,
        eq(clubData.isDeleted, false),
      ),
    )
    .orderBy(clubData.clubName);
  if (clubs.length === 0) return [];

  const clubIds = clubs.map((c) => c.clubId);
  const [categories, groupLinks] = await Promise.all([
    db.select().from(categoryData).where(inArray(categoryData.clubId, clubIds)).orderBy(categoryData.categoryId),
    // One row per group category, or one row with a null category for a group with none
    db
      .select({ clubId: clubMemberGroups.clubId, categoryId: categoryClubGroupAssignment.categoryId })
      .from(studentClubGroupAssignment)
      .innerJoin(clubMemberGroups, eq(clubMemberGroups.groupId, studentClubGroupAssignment.groupId))
      .leftJoin(categoryClubGroupAssignment, eq(categoryClubGroupAssignment.groupId, clubMemberGroups.groupId))
      .where(and(eq(studentClubGroupAssignment.studentId, studentId), inArray(clubMemberGroups.clubId, clubIds))),
  ]);

  return clubs.map((club) => {
    const links = groupLinks.filter((l) => l.clubId === club.clubId);
    const groupCategoryIds = new Set(links.map((l) => l.categoryId));

    return {
      ...club,
      categories: categories.filter(
        (c) => c.clubId === club.clubId && (links.length === 0 || groupCategoryIds.has(c.categoryId)),
      ),
    };
  });
};

export const getLogHoursClubs = async (): Promise<LogHoursClub[]> => {
  const clubs = await getClubsFor(CURRENT_STUDENT_ID);

  return clubs.map((club) => ({
    clubId: club.clubId,
    clubName: club.clubName ?? "",
    categories: club.categories.map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName ?? "",
      needsEmailVerification: c.needsEmailVerification ?? false,
      needsClubConfirmation: c.needsClubConfirmation ?? false,
    })),
  }));
};

// Approved and pending hours in each of the student's clubs, against the goals of the
// categories open to them. Hours in a category outside the student's groups do not count.
export const getGoalProgress = async (): Promise<ClubGoalProgress[]> => getGoalProgressFor(CURRENT_STUDENT_ID);

// Goal Progress for any student, for staff and admin Look Up Students.
// TODO: check the session is staff or admin once auth is added
export const getStudentGoalProgress = async (studentId: number): Promise<ClubGoalProgress[]> =>
  getGoalProgressFor(studentId, { includeInactive: true });

const getGoalProgressFor = async (studentId: number, options?: ClubsOptions): Promise<ClubGoalProgress[]> => {
  const clubs = await getClubsFor(studentId, options);
  if (clubs.length === 0) return [];

  const clubIds = clubs.map((c) => c.clubId);
  const mine = (table: typeof loggedHours | typeof additionalHours) =>
    and(eq(table.studentId, studentId), inArray(table.clubId, clubIds));

  const [logged, added] = await Promise.all([
    db
      .select({
        clubId: loggedHours.clubId,
        categoryId: loggedHours.categoryId,
        status: loggedHours.status,
        hours: sql<number>`coalesce(sum(${loggedHours.hours}), 0)`.mapWith(Number),
      })
      .from(loggedHours)
      .where(
        and(
          mine(loggedHours),
          inArray(loggedHours.status, ["Approved", "Pending Email Verification", "Pending Club Verification"]),
        ),
      )
      .groupBy(loggedHours.clubId, loggedHours.categoryId, loggedHours.status),
    db
      .select({
        clubId: additionalHours.clubId,
        categoryId: additionalHours.categoryId,
        hours: sql<number>`coalesce(sum(${additionalHours.hours}), 0)`.mapWith(Number),
      })
      .from(additionalHours)
      .where(mine(additionalHours))
      .groupBy(additionalHours.clubId, additionalHours.categoryId),
  ]);

  const approved = [...logged.filter((r) => r.status === "Approved"), ...added];
  const pending = logged.filter((r) => r.status !== "Approved");
  const sumHours = (rows: { hours: number }[]) => roundHours(rows.reduce((total, r) => total + r.hours, 0));

  return clubs.map((club) => {
    const inClub = (rows: typeof approved) => rows.filter((r) => r.clubId === club.clubId);
    const inCategory = (rows: typeof approved, categoryId: number) =>
      sumHours(inClub(rows).filter((r) => r.categoryId === categoryId));
    const categories = club.categories.map((c) => ({
      name: c.categoryName ?? "",
      value: inCategory(approved, c.categoryId),
      goal: c.goal ?? 0,
      pending: inCategory(pending, c.categoryId),
    }));
    const goal = categories.reduce((total, c) => total + c.goal, 0);

    return {
      clubId: club.clubId,
      clubName: club.clubName ?? "",
      // Hours past a category's goal do not fill another category's share of the club goal
      earned: roundHours(categories.reduce((total, c) => total + Math.min(c.value, c.goal), 0)),
      goal,
      pending: sumHours(inClub(pending)),
      categories,
      noHoursNeeded: !!club.isExec && club.execNeedsHours === false,
      isExec: !!club.isExec,
      isActive: !!club.isActive,
      added: sumHours(inClub(added)),
    };
  });
};

// The student's requests, newest first.
export const getMyRequests = async (): Promise<MyRequest[]> => getRequestsFor(CURRENT_STUDENT_ID);

// Every request a student logged, in any club, for staff and admin Look Up Students.
// TODO: check the session is staff or admin once auth is added
export const getStudentRequests = async (studentId: number): Promise<MyRequest[]> => getRequestsFor(studentId);

const getRequestsFor = async (studentId: number): Promise<MyRequest[]> => {
  const rows = await db
    .select({
      request: loggedHours,
      clubName: clubData.clubName,
      categoryName: categoryData.categoryName,
      canChange: sql<boolean>`${IS_UNVERIFIED}`,
    })
    .from(loggedHours)
    .leftJoin(clubData, eq(clubData.clubId, loggedHours.clubId))
    .leftJoin(categoryData, eq(categoryData.categoryId, loggedHours.categoryId))
    .where(eq(loggedHours.studentId, studentId))
    .orderBy(desc(loggedHours.date), desc(loggedHours.num));

  return rows.map(({ request, clubName, categoryName, canChange }) => ({
    id: request.num,
    clubId: request.clubId,
    categoryId: request.categoryId,
    opportunity: request.opportunityName ?? "",
    club: clubName ?? undefined,
    category: categoryName ?? undefined,
    date: formatDate(request.date, "short"),
    fullDate: formatDate(request.date),
    isoDate: request.date ?? "",
    hours: request.hours ?? 0,
    status: request.status as HourRequestStatus,
    hasPhoto: !!request.imageId,
    organization: request.orgName ?? undefined,
    coordinator: request.coordinatorName ?? undefined,
    coordinatorEmail: request.coordinatorEmail ?? undefined,
    message: request.optionalMessage ?? undefined,
    denyMessage: request.denyMessage ?? undefined,
    canChange: !!canChange,
  }));
};

// The My Requests badge in the side nav.
export const getMyPendingRequestCount = async (): Promise<number> => {
  const [row] = await db
    .select({ pending: count() })
    .from(loggedHours)
    .where(
      and(
        eq(loggedHours.studentId, CURRENT_STUDENT_ID),
        inArray(loggedHours.status, ["Pending Email Verification", "Pending Club Verification"]),
      ),
    );

  return row?.pending ?? 0;
};

//--------------------------------------------------------------------------------------//
//                                         Save                                        //
//--------------------------------------------------------------------------------------//

export const logHours = async (
  input: LogHoursInput,
): Promise<{ success: true; status: HourRequestStatus } | { success: false; error: string }> => {
  // The club and category must be open to this student
  const club = (await getLogHoursClubs()).find((c) => c.clubId === input.clubId);
  if (!club) return { success: false, error: "You are not an active member of that club." };
  const category = club.categories.find((c) => c.categoryId === input.categoryId);
  if (!category) return { success: false, error: `You cannot log hours in that category for ${club.clubName}.` };

  // Validate
  const fields = cleanLoggedHours(input);
  const errors = validateLoggedHours(fields, {
    needsEmailVerification: category.needsEmailVerification,
    today: schoolToday(),
  });
  const firstError = Object.values(errors)[0];
  if (firstError) return { success: false, error: firstError };

  // Write
  const status = statusFor(category);
  await db.insert(loggedHours).values({
    studentId: CURRENT_STUDENT_ID,
    clubId: club.clubId,
    categoryId: category.categoryId,
    opportunityName: fields.opportunityName,
    orgName: fields.orgName,
    date: fields.date,
    hours: Number(fields.hours),
    coordinatorName: category.needsEmailVerification ? fields.coordinatorName : null,
    coordinatorEmail: category.needsEmailVerification ? fields.coordinatorEmail : null,
    optionalMessage: fields.message || null,
    status,
  });

  refresh();
  return { success: true, status };
};

// Club and category stay as logged, so the request keeps its place in the verification steps.
// TODO: send the coordinator a new email when their address changes, once verification emails are added
export const updateMyRequest = async (requestId: number, input: LoggedHoursFields): Promise<MyRequestResult> => {
  const isChangeable = and(
    eq(loggedHours.num, requestId),
    eq(loggedHours.studentId, CURRENT_STUDENT_ID),
    IS_UNVERIFIED,
  );

  const [request] = await db.select({ status: loggedHours.status }).from(loggedHours).where(isChangeable);
  if (!request) {
    refresh();
    return { success: false, error: ALREADY_VERIFIED };
  }
  const needsEmailVerification = request.status === "Pending Email Verification";

  // Validate
  const fields = cleanLoggedHours(input);
  const errors = validateLoggedHours(fields, { needsEmailVerification, today: schoolToday() });
  const firstError = Object.values(errors)[0];
  if (firstError) return { success: false, error: firstError };

  // Write
  const updated = await db
    .update(loggedHours)
    .set({
      opportunityName: fields.opportunityName,
      orgName: fields.orgName,
      date: fields.date,
      hours: Number(fields.hours),
      coordinatorName: needsEmailVerification ? fields.coordinatorName : null,
      coordinatorEmail: needsEmailVerification ? fields.coordinatorEmail : null,
      optionalMessage: fields.message || null,
    })
    .where(isChangeable)
    .returning({ num: loggedHours.num });

  refresh();
  return updated.length > 0 ? { success: true } : { success: false, error: ALREADY_VERIFIED };
};

//--------------------------------------------------------------------------------------//
//                                        Delete                                        //
//--------------------------------------------------------------------------------------//

export const deleteMyRequest = async (requestId: number): Promise<MyRequestResult> => {
  const deleted = await db
    .delete(loggedHours)
    .where(and(eq(loggedHours.num, requestId), eq(loggedHours.studentId, CURRENT_STUDENT_ID), IS_UNVERIFIED))
    .returning({ num: loggedHours.num });

  refresh();
  return deleted.length > 0 ? { success: true } : { success: false, error: ALREADY_VERIFIED };
};
