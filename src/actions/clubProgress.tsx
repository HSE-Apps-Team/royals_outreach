"use server";

import { db } from "@/db";
import { additionalHours, categoryClubGroupAssignment, clubMemberGroups, loggedHours } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getClubConfigById } from "@/actions/club";
import { getClubCategories } from "@/actions/categories";
import { getClubMembers } from "@/actions/members";

/** Hours toward one category goal. Value is approved hours; pending still waits on verification. */
export type CategoryHours = {
  categoryId: number;
  name: string;
  value: number;
  goal: number;
  pending: number;
};

/** One active member on Hours Progress. */
export type StudentProgress = {
  studentId: number;
  fName: string;
  lName: string;
  gradClass: number | null;
  groupId: number | null;
  groupName: string | null;
  /** Approved hours toward the goal, each category counted up to its own goal. */
  earned: number;
  /** Every approved hour, including hours past a category's goal. */
  approved: number;
  goal: number;
  pending: number;
  categories: CategoryHours[];
  /** Every category is at its goal. */
  met: boolean;
  /** An exec in a club where execs do not need hours. Left out of the club totals. */
  noHoursNeeded: boolean;
};

/** A category across every student who has it. */
export type CategoryTotal = CategoryHours & { students: number };

export type ClubProgress = {
  clubName: string;
  groups: { groupId: number; groupName: string }[];
  students: StudentProgress[];
  /** Club totals, from the students who need hours. */
  total: {
    earned: number;
    goal: number;
    approved: number;
    pending: number;
    students: number;
    metGoal: number;
    categories: CategoryTotal[];
  };
};

//--------------------------------------------------------------------------------------//
//                                   Other Functions                                    //
//--------------------------------------------------------------------------------------//

// Sums of tenth and quarter hours drift in floating point (0.1 + 0.2), so totals keep two places
const roundHours = (hours: number) => Math.round(hours * 100) / 100;

const sum = <T,>(rows: T[], value: (row: T) => number) => roundHours(rows.reduce((total, r) => total + value(r), 0));

// The part of a category's hours that counts toward its goal, with pending filling what is left
const capped = (c: CategoryHours) => {
  const value = Math.min(c.value, c.goal);
  return { value, pending: Math.min(c.pending, c.goal - value) };
};

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

// Every active member's hours against the categories open to them. A student in a member
// group gets that group's categories; a student with no group gets every category in the club.
export const getClubProgress = async (clubId: number): Promise<ClubProgress | null> => {
  const [club, categories, members, groups, groupLinks, logged, added] = await Promise.all([
    getClubConfigById(clubId),
    getClubCategories(clubId),
    getClubMembers(clubId),
    db
      .select({ groupId: clubMemberGroups.groupId, groupName: clubMemberGroups.groupName })
      .from(clubMemberGroups)
      .where(eq(clubMemberGroups.clubId, clubId))
      .orderBy(clubMemberGroups.groupName),
    db
      .select({ groupId: categoryClubGroupAssignment.groupId, categoryId: categoryClubGroupAssignment.categoryId })
      .from(categoryClubGroupAssignment)
      .innerJoin(clubMemberGroups, eq(clubMemberGroups.groupId, categoryClubGroupAssignment.groupId))
      .where(eq(clubMemberGroups.clubId, clubId)),
    db
      .select({
        studentId: loggedHours.studentId,
        categoryId: loggedHours.categoryId,
        approved: sql<boolean>`${loggedHours.status} = 'Approved'`,
        hours: sql<number>`coalesce(sum(${loggedHours.hours}), 0)`.mapWith(Number),
      })
      .from(loggedHours)
      .where(
        and(
          eq(loggedHours.clubId, clubId),
          inArray(loggedHours.status, ["Approved", "Pending Email Verification", "Pending Club Verification"]),
        ),
      )
      .groupBy(loggedHours.studentId, loggedHours.categoryId, sql`${loggedHours.status} = 'Approved'`),
    db
      .select({
        studentId: additionalHours.studentId,
        categoryId: additionalHours.categoryId,
        hours: sql<number>`coalesce(sum(${additionalHours.hours}), 0)`.mapWith(Number),
      })
      .from(additionalHours)
      .where(eq(additionalHours.clubId, clubId))
      .groupBy(additionalHours.studentId, additionalHours.categoryId),
  ]);
  if (!club) return null;

  const approvedRows = [...logged.filter((r) => r.approved), ...added];
  const pendingRows = logged.filter((r) => !r.approved);
  const hoursFor = (rows: typeof added, studentId: number, categoryId: number) =>
    sum(
      rows.filter((r) => r.studentId === studentId && r.categoryId === categoryId),
      (r) => r.hours,
    );

  const students: StudentProgress[] = members
    .filter((m) => m.isActive)
    .map((m) => {
      const groupCategoryIds = new Set(groupLinks.filter((l) => l.groupId === m.groupId).map((l) => l.categoryId));
      const own: CategoryHours[] = categories
        .filter((c) => m.groupId === null || groupCategoryIds.has(c.categoryId))
        .map((c) => ({
          categoryId: c.categoryId,
          name: c.categoryName,
          value: hoursFor(approvedRows, m.studentId, c.categoryId),
          goal: c.goal,
          pending: hoursFor(pendingRows, m.studentId, c.categoryId),
        }));

      return {
        studentId: m.studentId,
        fName: m.fName,
        lName: m.lName,
        gradClass: m.gradClass,
        groupId: m.groupId,
        groupName: m.groupName,
        earned: sum(own, (c) => capped(c).value),
        approved: sum(own, (c) => c.value),
        goal: sum(own, (c) => c.goal),
        pending: sum(own, (c) => c.pending),
        categories: own,
        met: own.length > 0 && own.every((c) => c.value >= c.goal),
        noHoursNeeded: m.isExec && !club.execNeedsHours,
      };
    })
    .sort((a, b) => `${a.lName} ${a.fName}`.localeCompare(`${b.lName} ${b.fName}`, undefined, { sensitivity: "base" }));

  const counted = students.filter((s) => !s.noHoursNeeded);
  const totalCategories: CategoryTotal[] = categories.map((c) => {
    const has = counted.map((s) => s.categories.find((k) => k.categoryId === c.categoryId)).filter((k) => !!k);
    return {
      categoryId: c.categoryId,
      name: c.categoryName,
      value: sum(has, (k) => capped(k).value),
      goal: sum(has, (k) => k.goal),
      pending: sum(has, (k) => capped(k).pending),
      students: has.length,
    };
  });

  return {
    clubName: club.clubName,
    groups: groups.map((g) => ({ groupId: g.groupId, groupName: g.groupName ?? "" })),
    students,
    total: {
      earned: sum(counted, (s) => s.earned),
      goal: sum(counted, (s) => s.goal),
      approved: sum(counted, (s) => s.approved),
      pending: sum(counted, (s) => s.pending),
      students: counted.length,
      metGoal: counted.filter((s) => s.met).length,
      categories: totalCategories,
    },
  };
};
