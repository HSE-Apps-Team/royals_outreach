"use server";

import { db } from "@/db";
import { additionalHours, clubData, clubStaffAssignment, loggedHours, staffUserData } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { CURRENT_STAFF_ID } from "@/lib/currentStaff";

export type CurrentStaff = {
  staffId: number;
  fName: string;
  lName: string;
};

/** A club the staff member sponsors, on Staff Home. */
export type StaffClub = {
  clubId: number;
  clubName: string;
  /** Approved hours across every student in the club. */
  totalHours: number;
};

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

export const getCurrentStaff = async (): Promise<CurrentStaff | null> => {
  const [staff] = await db.select().from(staffUserData).where(eq(staffUserData.staffId, CURRENT_STAFF_ID));
  if (!staff) return null;

  return { staffId: staff.staffId, fName: staff.fName ?? "", lName: staff.lName ?? "" };
};

// The clubs this staff member is assigned to, with each club's approved hours.
export const getMyStaffClubs = async (): Promise<StaffClub[]> => {
  const clubs = await db
    .select({ clubId: clubData.clubId, clubName: clubData.clubName })
    .from(clubStaffAssignment)
    .innerJoin(clubData, eq(clubData.clubId, clubStaffAssignment.clubId))
    .where(eq(clubStaffAssignment.staffId, CURRENT_STAFF_ID))
    .orderBy(clubData.clubName);
  if (clubs.length === 0) return [];

  const clubIds = clubs.map((c) => c.clubId);
  const [logged, added] = await Promise.all([
    db
      .select({ clubId: loggedHours.clubId, hours: sql<number>`coalesce(sum(${loggedHours.hours}), 0)`.mapWith(Number) })
      .from(loggedHours)
      .where(and(inArray(loggedHours.clubId, clubIds), eq(loggedHours.status, "Approved")))
      .groupBy(loggedHours.clubId),
    db
      .select({ clubId: additionalHours.clubId, hours: sql<number>`coalesce(sum(${additionalHours.hours}), 0)`.mapWith(Number) })
      .from(additionalHours)
      .where(inArray(additionalHours.clubId, clubIds))
      .groupBy(additionalHours.clubId),
  ]);

  const hoursIn = (rows: typeof logged, clubId: number) => rows.find((r) => r.clubId === clubId)?.hours ?? 0;

  return clubs.map((c) => ({
    clubId: c.clubId,
    clubName: c.clubName ?? "",
    // Sums of tenth and quarter hours drift in floating point, so the total keeps two places
    totalHours: Math.round((hoursIn(logged, c.clubId) + hoursIn(added, c.clubId)) * 100) / 100,
  }));
};
