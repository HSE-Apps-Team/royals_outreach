"use server";

import { db } from "@/db";
import { categoryData, clubData, registrations, signUps } from "@/db/schema";
import { and, asc, eq, gte } from "drizzle-orm";
import { refresh } from "next/cache";
import type { Opportunity } from "@/app/components/opportunityCard";
import { CURRENT_STUDENT_ID } from "@/lib/currentStudent";
import { formatDate, monthName } from "@/lib/formatDate";
import { formatTimeRange } from "@/lib/formatTime";
import { schoolToday } from "@/lib/schoolDate";

// sign_ups.date is an ISO date ("2026-10-10") and start_time / end_time are "HH:MM", so
// ISO dates compare as text. A registration row is the student's spot; cancelling deletes it.

/** One of the student's registrations. The id is the registration, since a student can hold several spots. */
export type MySignUp = Opportunity & {
  /** Full date for the cancel dialog ("Oct 10, 2026"). */
  fullDate: string;
};

export type SignUpResult = { success: true } | { success: false; error: string };

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

// The student's registrations from today on, soonest first. Deleted clubs are left out.
export const getMyUpcomingSignUps = async (): Promise<MySignUp[]> => {
  const rows = await db
    .select({
      registrationId: registrations.num,
      name: signUps.name,
      date: signUps.date,
      startTime: signUps.startTime,
      endTime: signUps.endTime,
      location: signUps.location,
      hours: signUps.hours,
      categoryName: categoryData.categoryName,
      clubName: clubData.clubName,
    })
    .from(registrations)
    .innerJoin(signUps, eq(signUps.signUpId, registrations.signUpId))
    .innerJoin(categoryData, eq(categoryData.categoryId, signUps.categoryId))
    .innerJoin(clubData, eq(clubData.clubId, categoryData.clubId))
    .where(
      and(
        eq(registrations.studentId, CURRENT_STUDENT_ID),
        gte(signUps.date, schoolToday()),
        eq(clubData.isDeleted, false),
      ),
    )
    .orderBy(asc(signUps.date), asc(signUps.startTime), asc(registrations.num));

  return rows.map((row) => {
    const month = Number(row.date?.slice(5, 7));
    return {
      id: row.registrationId,
      name: row.name ?? "",
      month: monthName(month - 1).toUpperCase(),
      day: Number(row.date?.slice(8, 10)) || "",
      club: row.clubName ?? undefined,
      time: formatTimeRange(row.startTime, row.endTime) || undefined,
      location: row.location?.trim() || undefined,
      category: row.categoryName ?? undefined,
      hours: row.hours ?? 0,
      fullDate: formatDate(row.date),
    };
  });
};

//--------------------------------------------------------------------------------------//
//                                        Delete                                        //
//--------------------------------------------------------------------------------------//

// Gives up the student's spot. Past events stay, so the record of who came is kept.
export const cancelMySignUp = async (registrationId: number): Promise<SignUpResult> => {
  const [registration] = await db
    .select({ date: signUps.date })
    .from(registrations)
    .innerJoin(signUps, eq(signUps.signUpId, registrations.signUpId))
    .where(and(eq(registrations.num, registrationId), eq(registrations.studentId, CURRENT_STUDENT_ID)));

  if (!registration) return { success: false, error: "This sign up was already cancelled." };
  if (!registration.date || registration.date < schoolToday()) {
    return { success: false, error: "This event has already happened, so it can no longer be cancelled." };
  }

  await db
    .delete(registrations)
    .where(and(eq(registrations.num, registrationId), eq(registrations.studentId, CURRENT_STUDENT_ID)));

  refresh();
  return { success: true };
};
