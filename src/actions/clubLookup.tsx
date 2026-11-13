"use server";

import { db } from "@/db";
import { additionalHours } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getClubProgress, type CategoryHours } from "@/actions/clubProgress";
import { getClubMembers } from "@/actions/members";
import { getClubRequests, type ClubRequest } from "@/actions/clubRequests";

/** One member, active or not, on the club's Look Up Students page. */
export type ClubLookupStudent = {
  studentId: number;
  isActive: boolean;
  fName: string;
  lName: string;
  email: string;
  gradClass: number | null;
  groupName: string | null;
  /** The categories open to the student, with approved hours (logged and added). */
  categories: CategoryHours[];
  /** Hours the club added for the student; they have no log row. */
  added: number;
  /** Every request the student logged to this club, newest first. */
  logs: ClubRequest[];
};

export type ClubLookup = {
  clubName: string;
  students: ClubLookupStudent[];
};

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

// Every member, inactive ones included, sorted by last name then first name.
export const getClubLookup = async (clubId: number): Promise<ClubLookup | null> => {
  const [progress, members, requests, added] = await Promise.all([
    getClubProgress(clubId, { includeInactive: true }),
    getClubMembers(clubId),
    getClubRequests(clubId),
    db
      .select({
        studentId: additionalHours.studentId,
        hours: sql<number>`coalesce(sum(${additionalHours.hours}), 0)`.mapWith(Number),
      })
      .from(additionalHours)
      .where(eq(additionalHours.clubId, clubId))
      .groupBy(additionalHours.studentId),
  ]);
  if (!progress) return null;

  const emailOf = new Map(members.map((m) => [m.studentId, m.email]));
  const addedOf = new Map(added.map((a) => [a.studentId, a.hours]));
  const logsOf = new Map<number | null, ClubRequest[]>();
  for (const r of requests) logsOf.set(r.studentId, [...(logsOf.get(r.studentId) ?? []), r]);

  return {
    clubName: progress.clubName,
    students: progress.students.map((s) => ({
      studentId: s.studentId,
      isActive: s.isActive,
      fName: s.fName,
      lName: s.lName,
      email: emailOf.get(s.studentId) ?? "",
      gradClass: s.gradClass,
      groupName: s.groupName,
      categories: s.categories,
      added: addedOf.get(s.studentId) ?? 0,
      logs: logsOf.get(s.studentId) ?? [],
    })),
  };
};
