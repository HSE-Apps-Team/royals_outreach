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
import { and, eq, inArray, sql } from "drizzle-orm";

// Goal progress for a student. Plain server code (not a server action) so pages and emails
// can share it. The server actions in src/actions/hours.tsx are the entry points for pages.

/** One club on Goal Progress. Every club has at least one category (General Hours if nothing else). */
export type ClubGoalProgress = {
  clubId: number;
  clubName: string;
  /** Approved hours toward the goal, each category counted up to its own goal. */
  earned: number;
  goal: number;
  pending: number;
  /** Value is approved hours; pending is hours still waiting on verification. */
  categories: { categoryId: number; name: string; value: number; goal: number; pending: number }[];
  /** An exec in a club where execs do not need hours. */
  noHoursNeeded: boolean;
  isExec: boolean;
  /** Always true for the student's own pages; Look Up Students also lists inactive memberships. */
  isActive: boolean;
  /** Hours the club added for the student (no log row), already counted in the categories. */
  added: number;
};

export type ClubsOptions = { includeInactive?: boolean };

// Sums of tenth and quarter hours drift in floating point (0.1 + 0.2), so totals keep two places
const roundHours = (hours: number) => Math.round(hours * 100) / 100;

// A student's active clubs (inactive ones too with includeInactive). A student in a member
// group gets that group's categories; a student with no group gets every category in the club.
export const getClubsFor = async (studentId: number, { includeInactive = false }: ClubsOptions = {}) => {
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

export const getGoalProgressFor = async (studentId: number, options?: ClubsOptions): Promise<ClubGoalProgress[]> => {
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
      categoryId: c.categoryId,
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

