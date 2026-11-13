"use server";

import { db } from "@/db";
import { additionalHours, clubData, loggedHours } from "@/db/schema";
import { and, count, eq, gte, sql, sum } from "drizzle-orm";
import { schoolToday } from "@/lib/schoolDate";

export type SchoolStats = {
  /** Approved logged hours plus manually added hours. */
  totalHours: number;
  /** Students with any approved or added hours. */
  studentsServing: number;
  clubs: number;
  /** Approved logged hours dated in the current month at the school. */
  hoursThisMonth: number;
};

// Read
export const getSchoolStats = async (): Promise<SchoolStats> => {
  const monthStart = `${schoolToday().slice(0, 8)}01`;
  const isApproved = eq(loggedHours.status, "Approved");

  const [[logged], [added], [students], [clubs], [thisMonth]] = await Promise.all([
    db.select({ hours: sum(loggedHours.hours).mapWith(Number) }).from(loggedHours).where(isApproved),
    db.select({ hours: sum(additionalHours.hours).mapWith(Number) }).from(additionalHours),
    // Union drops duplicates, so a student with both kinds of hours counts once
    db.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select ${loggedHours.studentId} from ${loggedHours} where ${isApproved}
        union
        select ${additionalHours.studentId} from ${additionalHours}
      ) serving
    `).then((result) => result.rows),
    db.select({ n: count() }).from(clubData).where(eq(clubData.isDeleted, false)),
    db
      .select({ hours: sum(loggedHours.hours).mapWith(Number) })
      .from(loggedHours)
      .where(and(isApproved, gte(loggedHours.date, monthStart))),
  ]);

  // sum() is null when there are no rows
  return {
    totalHours: (logged?.hours ?? 0) + (added?.hours ?? 0),
    studentsServing: Number(students?.n ?? 0),
    clubs: clubs?.n ?? 0,
    hoursThisMonth: thisMonth?.hours ?? 0,
  };
};
