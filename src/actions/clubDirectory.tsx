"use server";

import { db } from "@/db";
import {
  categoryData,
  clubData,
  clubStaffAssignment,
  loggedHours,
  staffUserData,
  studentClubMembership,
} from "@/db/schema";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";

// The All Clubs page (staff and admin): every club, creating clubs, assigning staff and,
// for admins, deleting clubs.

/** A staff member offered in the Create Club and Assign Staff dialogs. */
export type StaffMember = {
  staffId: number;
  fName: string;
  lName: string;
};

/** A club on the All Clubs page. */
export type DirectoryClubRow = {
  clubId: number;
  clubName: string;
  /** Active members (a missing status counts as active). */
  members: number;
  categories: number;
  staff: StaffMember[];
};

type ActionResult = { success: true } | { success: false; error: string };

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

// Every staff member, by last name then first name.
export const getAllStaff = async (): Promise<StaffMember[]> => {
  const staff = await db
    .select({ staffId: staffUserData.staffId, fName: staffUserData.fName, lName: staffUserData.lName })
    .from(staffUserData)
    .orderBy(staffUserData.lName, staffUserData.fName);

  return staff.map((s) => ({ staffId: s.staffId, fName: s.fName ?? "", lName: s.lName ?? "" }));
};

// Every club with its member count, category count and assigned staff, for All Clubs.
export const getAllClubs = async (): Promise<DirectoryClubRow[]> => {
  const [clubs, members, categories, staff] = await Promise.all([
    db
      .select({ clubId: clubData.clubId, clubName: clubData.clubName })
      .from(clubData)
      .where(eq(clubData.isDeleted, false))
      .orderBy(clubData.clubName),
    db
      .select({ clubId: studentClubMembership.clubId, n: count() })
      .from(studentClubMembership)
      .where(sql`coalesce(${studentClubMembership.membership_status}, true)`)
      .groupBy(studentClubMembership.clubId),
    db
      .select({ clubId: categoryData.clubId, n: count() })
      .from(categoryData)
      .groupBy(categoryData.clubId),
    db
      .select({
        clubId: clubStaffAssignment.clubId,
        staffId: staffUserData.staffId,
        fName: staffUserData.fName,
        lName: staffUserData.lName,
      })
      .from(clubStaffAssignment)
      .innerJoin(staffUserData, eq(staffUserData.staffId, clubStaffAssignment.staffId))
      .orderBy(staffUserData.lName, staffUserData.fName),
  ]);

  const countIn = (rows: typeof members, clubId: number) => rows.find((r) => r.clubId === clubId)?.n ?? 0;

  return clubs.map((c) => ({
    clubId: c.clubId,
    clubName: c.clubName ?? "",
    members: countIn(members, c.clubId),
    categories: countIn(categories, c.clubId),
    staff: staff
      .filter((s) => s.clubId === c.clubId)
      .map((s) => ({ staffId: s.staffId, fName: s.fName ?? "", lName: s.lName ?? "" })),
  }));
};

//--------------------------------------------------------------------------------------//
//                                        Create                                        //
//--------------------------------------------------------------------------------------//

// A new club only has a name; its hour settings are filled in on Club Config.
// Staff and admins can create clubs and assign staff. Deleting clubs is admin only.
export const createClub = async (name: string, staffId: number | null): Promise<ActionResult> => {
  const clubName = name.trim().replace(/\s+/g, " ");
  if (!clubName) return { success: false, error: "Club name is required." };

  const [existing] = await db
    .select({ clubId: clubData.clubId })
    .from(clubData)
    // A deleted club's name can be reused
    .where(and(sql`lower(${clubData.clubName}) = lower(${clubName})`, eq(clubData.isDeleted, false)));
  if (existing) return { success: false, error: `${clubName} already exists.` };

  const [club] = await db.insert(clubData).values({ clubName }).returning({ clubId: clubData.clubId });
  if (staffId !== null) {
    await db.insert(clubStaffAssignment).values({ clubId: club.clubId, staffId });
  }

  refresh();
  return { success: true };
};

export const addStaffToClub = async (clubId: number, staffId: number): Promise<ActionResult> => {
  // Skip the insert when the staff member is already assigned, so a double click adds one row
  const [existing] = await db
    .select({ num: clubStaffAssignment.num })
    .from(clubStaffAssignment)
    .where(and(eq(clubStaffAssignment.clubId, clubId), eq(clubStaffAssignment.staffId, staffId)));
  if (!existing) {
    await db.insert(clubStaffAssignment).values({ clubId, staffId });
  }

  refresh();
  return { success: true };
};

//--------------------------------------------------------------------------------------//
//                                        Delete                                        //
//--------------------------------------------------------------------------------------//

export const removeStaffFromClub = async (clubId: number, staffId: number): Promise<ActionResult> => {
  await db
    .delete(clubStaffAssignment)
    .where(and(eq(clubStaffAssignment.clubId, clubId), eq(clubStaffAssignment.staffId, staffId)));

  refresh();
  return { success: true };
};

const DELETED_CLUB_MESSAGE = "This club was deleted.";

// Soft delete: the club and everything under it stay in the database, so students' logged
// hours keep their club and category names. The club disappears from every list and its
// panel 404s. Undo by setting is_deleted back to false (denied requests stay denied).
// TODO: check the session is an admin once auth is added
export const deleteClub = async (clubId: number): Promise<ActionResult> => {
  // No one can review a deleted club's requests, so pending ones are denied. As with an exec's
  // deny, a coordinator who never verified the request is dropped from it.
  await db
    .update(loggedHours)
    .set({
      status: "Denied",
      denyMessage: DELETED_CLUB_MESSAGE,
      coordinatorName: sql`case when ${loggedHours.status} = 'Pending Email Verification' then null else ${loggedHours.coordinatorName} end`,
      coordinatorEmail: sql`case when ${loggedHours.status} = 'Pending Email Verification' then null else ${loggedHours.coordinatorEmail} end`,
    })
    .where(
      and(
        eq(loggedHours.clubId, clubId),
        inArray(loggedHours.status, ["Pending Email Verification", "Pending Club Verification"]),
      ),
    );
  await db.update(clubData).set({ isDeleted: true }).where(eq(clubData.clubId, clubId));

  refresh();
  return { success: true };
};
