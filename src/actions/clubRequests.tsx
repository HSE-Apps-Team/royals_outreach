"use server";

import { db } from "@/db";
import { categoryData, clubData, loggedHours, studentClubMembership, studentUserData } from "@/db/schema";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { after } from "next/server";
import type { HourRequest, HourRequestStatus } from "@/app/components/requestRow";
import { formatDate } from "@/lib/formatDate";
import { schoolDateOf, schoolToday } from "@/lib/schoolDate";
import { sendCoordinatorEmails } from "@/lib/coordinatorEmails";
import { cancelDeletedClubEmails, updateClubDecisionEmails } from "@/lib/studentEmails";
import { MAX_MESSAGE_LENGTH, dateError, hoursError, opportunityNameError } from "@/lib/validateLoggedHours";

/** A request on the club panel's Hour Requests page. */
export type ClubRequest = HourRequest & {
  id: number;
  studentId: number | null;
  categoryId: number | null;
  /** ISO date, e.g. "2026-10-10". */
  isoDate: string;
  /** The school's date the student submitted it, or null for rows logged before that was recorded. */
  submittedOn: string | null;
  /** Added by a club exec with Add Hours Manually (the only way to log without an organization). */
  isManual: boolean;
  studentEmail?: string;
};

/** A request as it was before a review, so Undo can put it back. */
export type ClubRequestSnapshot = {
  id: number;
  status: HourRequestStatus;
  denyMessage: string | null;
  coordinatorName: string | null;
  coordinatorEmail: string | null;
};

export type ClubRequestEdit = {
  hours: number;
  /** ISO date, e.g. "2026-10-10". */
  isoDate: string;
  categoryId: number | null;
  status: HourRequestStatus;
};

export type ManualHoursInput = {
  studentId: number;
  categoryId: number | null;
  opportunityName: string;
  /** ISO date, e.g. "2026-10-10". */
  isoDate: string;
  hours: string;
};

export type ClubRequestResult = { success: true } | { success: false; error: string };
export type ClubBulkResult = { success: true; changed: number } | { success: false; error: string };

const PENDING_STATUSES: HourRequestStatus[] = ["Pending Email Verification", "Pending Club Verification"];
const STATUSES: HourRequestStatus[] = [...PENDING_STATUSES, "Approved", "Denied"];

const ALREADY_REVIEWED = "This request was already reviewed. The list has been updated.";
const NOT_FOUND = "This request no longer exists. The list has been updated.";
const MAX_BULK = 500;

// A coordinator on a request past the email step means they verified it, so one who never
// answered cannot stay on the request when an exec decides it without them.
const DROP_UNVERIFIED_COORDINATOR = {
  coordinatorName: sql`case when ${loggedHours.status} = 'Pending Email Verification' then null else ${loggedHours.coordinatorName} end`,
  coordinatorEmail: sql`case when ${loggedHours.status} = 'Pending Email Verification' then null else ${loggedHours.coordinatorEmail} end`,
};

//--------------------------------------------------------------------------------------//
//                                   Other Functions                                    //
//--------------------------------------------------------------------------------------//

// The student hears about a club decision CLUB_EMAIL_DELAY_MS later (src/lib/studentEmails.ts),
// so an Undo or a change made in the meantime cancels the email instead.
const emailStudentsLater = (rows: { num: number }[]) => {
  if (rows.length > 0) after(() => updateClubDecisionEmails(rows.map((r) => r.num)));
};

const isClubRequest = (clubId: number, requestId: number) =>
  and(eq(loggedHours.num, requestId), eq(loggedHours.clubId, clubId));

const cleanIds = (ids: number[]) =>
  Array.isArray(ids) ? [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))] : [];

const denyMessageError = (denyMessage: string) =>
  denyMessage.length > MAX_MESSAGE_LENGTH ? `Keep the deny message under ${MAX_MESSAGE_LENGTH} characters.` : null;

const isInClub = async (clubId: number, categoryId: number) => {
  const [category] = await db
    .select({ categoryId: categoryData.categoryId })
    .from(categoryData)
    .where(and(eq(categoryData.categoryId, categoryId), eq(categoryData.clubId, clubId)));
  return !!category;
};

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

// Every request logged to the club, newest first.
export const getClubRequests = async (clubId: number): Promise<ClubRequest[]> => {
  const rows = await db
    .select({
      request: loggedHours,
      clubName: clubData.clubName,
      categoryName: categoryData.categoryName,
      fName: studentUserData.fName,
      lName: studentUserData.lName,
      studentEmail: studentUserData.email,
    })
    .from(loggedHours)
    .leftJoin(clubData, eq(clubData.clubId, loggedHours.clubId))
    .leftJoin(categoryData, eq(categoryData.categoryId, loggedHours.categoryId))
    .leftJoin(studentUserData, eq(studentUserData.studentId, loggedHours.studentId))
    .where(eq(loggedHours.clubId, clubId))
    .orderBy(desc(loggedHours.date), desc(loggedHours.num));

  return rows.map(({ request, clubName, categoryName, fName, lName, studentEmail }) => ({
    id: request.num,
    studentId: request.studentId,
    opportunity: request.opportunityName ?? "",
    student: { fName: fName ?? "", lName: lName ?? "" },
    club: clubName ?? undefined,
    category: categoryName ?? undefined,
    categoryId: request.categoryId,
    date: formatDate(request.date, "short"),
    fullDate: formatDate(request.date),
    isoDate: request.date ?? "",
    submittedOn: request.submittedAt ? schoolDateOf(request.submittedAt) : null,
    isManual: !request.orgName,
    studentEmail: studentEmail ?? undefined,
    hours: request.hours ?? 0,
    status: request.status as HourRequestStatus,
    hasPhoto: !!request.imageId,
    organization: request.orgName ?? undefined,
    coordinator: request.coordinatorName ?? undefined,
    coordinatorEmail: request.coordinatorEmail ?? undefined,
    message: request.optionalMessage ?? undefined,
    denyMessage: request.denyMessage ?? undefined,
  }));
};

// The Hour Requests badge in the side nav: only requests waiting on the club.
export const getClubPendingRequestCount = async (clubId: number): Promise<number> => {
  const [row] = await db
    .select({ pending: count() })
    .from(loggedHours)
    .where(and(eq(loggedHours.clubId, clubId), eq(loggedHours.status, "Pending Club Verification")));

  return row?.pending ?? 0;
};

//--------------------------------------------------------------------------------------//
//                                        Review                                        //
//--------------------------------------------------------------------------------------//

// Approving a request still waiting on its coordinator is the Override Approve button.
export const approveClubRequest = async (clubId: number, requestId: number): Promise<ClubRequestResult> => {
  const updated = await db
    .update(loggedHours)
    .set({ status: "Approved", denyMessage: null, ...DROP_UNVERIFIED_COORDINATOR })
    .where(and(isClubRequest(clubId, requestId), inArray(loggedHours.status, PENDING_STATUSES)))
    .returning({ num: loggedHours.num });

  emailStudentsLater(updated);
  refresh();
  return updated.length > 0 ? { success: true } : { success: false, error: ALREADY_REVIEWED };
};

export const denyClubRequest = async (
  clubId: number,
  requestId: number,
  message: string,
): Promise<ClubRequestResult> => {
  const denyMessage = String(message ?? "").trim();
  const problem = denyMessageError(denyMessage);
  if (problem) return { success: false, error: problem };

  const updated = await db
    .update(loggedHours)
    .set({ status: "Denied", denyMessage: denyMessage || null, ...DROP_UNVERIFIED_COORDINATOR })
    .where(and(isClubRequest(clubId, requestId), inArray(loggedHours.status, PENDING_STATUSES)))
    .returning({ num: loggedHours.num });

  emailStudentsLater(updated);
  refresh();
  return updated.length > 0 ? { success: true } : { success: false, error: ALREADY_REVIEWED };
};

// The bulk bar's Approve Selected. Rows someone else already reviewed are skipped.
export const approveClubRequests = async (clubId: number, ids: number[]): Promise<ClubBulkResult> => {
  const requestIds = cleanIds(ids);
  if (requestIds.length === 0) return { success: false, error: "Select at least one request." };
  if (requestIds.length > MAX_BULK) return { success: false, error: `Select ${MAX_BULK} requests or fewer.` };

  const updated = await db
    .update(loggedHours)
    .set({ status: "Approved", denyMessage: null, ...DROP_UNVERIFIED_COORDINATOR })
    .where(
      and(
        eq(loggedHours.clubId, clubId),
        inArray(loggedHours.num, requestIds),
        inArray(loggedHours.status, PENDING_STATUSES),
      ),
    )
    .returning({ num: loggedHours.num });

  emailStudentsLater(updated);
  refresh();
  return updated.length > 0 ? { success: true, changed: updated.length } : { success: false, error: ALREADY_REVIEWED };
};

// The bulk bar's Deny Selected, with one message for every student.
export const denyClubRequests = async (clubId: number, ids: number[], message: string): Promise<ClubBulkResult> => {
  const requestIds = cleanIds(ids);
  if (requestIds.length === 0) return { success: false, error: "Select at least one request." };
  if (requestIds.length > MAX_BULK) return { success: false, error: `Select ${MAX_BULK} requests or fewer.` };
  const denyMessage = String(message ?? "").trim();
  const problem = denyMessageError(denyMessage);
  if (problem) return { success: false, error: problem };

  const updated = await db
    .update(loggedHours)
    .set({ status: "Denied", denyMessage: denyMessage || null, ...DROP_UNVERIFIED_COORDINATOR })
    .where(
      and(
        eq(loggedHours.clubId, clubId),
        inArray(loggedHours.num, requestIds),
        inArray(loggedHours.status, PENDING_STATUSES),
      ),
    )
    .returning({ num: loggedHours.num });

  emailStudentsLater(updated);
  refresh();
  return updated.length > 0 ? { success: true, changed: updated.length } : { success: false, error: ALREADY_REVIEWED };
};

// Undo for approve and deny. A row only goes back while it still has the status the review
// set, so an undo never overwrites a later change by someone else.
export const restoreClubRequests = async (
  clubId: number,
  snapshots: ClubRequestSnapshot[],
  reviewedStatus: "Approved" | "Denied",
): Promise<ClubBulkResult> => {
  const valid = (Array.isArray(snapshots) ? snapshots : []).filter(
    (s) => Number.isInteger(s?.id) && s.id > 0 && PENDING_STATUSES.includes(s.status),
  );
  if (valid.length === 0 || valid.length > MAX_BULK || !["Approved", "Denied"].includes(reviewedStatus)) {
    return { success: false, error: "Nothing to undo." };
  }

  const text = (value: unknown, max: number) => {
    const clean = typeof value === "string" ? value.trim() : "";
    return clean ? clean.slice(0, max) : null;
  };

  const restored = await Promise.all(
    valid.map((s) =>
      db
        .update(loggedHours)
        .set({
          status: s.status,
          denyMessage: text(s.denyMessage, MAX_MESSAGE_LENGTH),
          coordinatorName: text(s.coordinatorName, 200),
          coordinatorEmail: text(s.coordinatorEmail, 320),
        })
        .where(and(isClubRequest(clubId, s.id), eq(loggedHours.status, reviewedStatus)))
        .returning({ num: loggedHours.num }),
    ),
  );

  // Cancels the student emails the review scheduled
  emailStudentsLater(restored.flat());
  refresh();
  const changed = restored.reduce((sum, rows) => sum + rows.length, 0);
  return changed > 0
    ? { success: true, changed }
    : { success: false, error: "These requests changed since your review, so they were not undone." };
};

//--------------------------------------------------------------------------------------//
//                                         Save                                         //
//--------------------------------------------------------------------------------------//

// Edit Or Override: an exec can set any status, including one that reopens a final request.
export const updateClubRequest = async (
  clubId: number,
  requestId: number,
  input: ClubRequestEdit,
): Promise<ClubRequestResult> => {
  // Validate
  const problem = hoursError(String(input.hours)) ?? dateError(input.isoDate, schoolToday());
  if (problem) return { success: false, error: problem };
  if (!STATUSES.includes(input.status)) return { success: false, error: "Choose a status." };
  if (input.categoryId !== null && !(await isInClub(clubId, input.categoryId))) {
    return { success: false, error: "That category is not in this club." };
  }

  const [request] = await db
    .select({ status: loggedHours.status })
    .from(loggedHours)
    .where(isClubRequest(clubId, requestId));
  if (!request) {
    refresh();
    return { success: false, error: NOT_FOUND };
  }

  const skipsEmail =
    request.status === "Pending Email Verification" && input.status !== "Pending Email Verification";

  // Write
  await db
    .update(loggedHours)
    .set({
      hours: input.hours,
      date: input.isoDate,
      categoryId: input.categoryId,
      status: input.status,
      ...(input.status === "Denied" ? {} : { denyMessage: null }),
      ...(skipsEmail ? { coordinatorName: null, coordinatorEmail: null } : {}),
    })
    .where(isClubRequest(clubId, requestId));

  // A new decision emails the student; reopening it cancels an email still waiting
  if (input.status !== request.status) emailStudentsLater([{ num: requestId }]);
  refresh();
  return { success: true };
};

// Hours an exec adds count right away, so they skip verification.
export const addClubHours = async (
  clubId: number,
  input: ManualHoursInput,
): Promise<{ success: true; requestId: number } | { success: false; error: string }> => {
  const opportunityName = String(input.opportunityName ?? "").trim().replace(/\s+/g, " ");
  const hours = String(input.hours ?? "").trim();

  // Validate
  const problem =
    opportunityNameError(opportunityName) ?? dateError(input.isoDate, schoolToday()) ?? hoursError(hours);
  if (problem) return { success: false, error: problem };

  const [member] = await db
    .select({ studentId: studentClubMembership.studentId })
    .from(studentClubMembership)
    .where(
      and(
        eq(studentClubMembership.clubId, clubId),
        eq(studentClubMembership.studentId, input.studentId),
        sql`coalesce(${studentClubMembership.membership_status}, true)`,
      ),
    );
  if (!member) return { success: false, error: "That student is not an active member of this club." };

  const [{ categories }] = await db
    .select({ categories: count() })
    .from(categoryData)
    .where(eq(categoryData.clubId, clubId));
  if (input.categoryId === null ? categories > 0 : !(await isInClub(clubId, input.categoryId))) {
    return { success: false, error: "Choose a category in this club." };
  }

  // Write
  const [added] = await db
    .insert(loggedHours)
    .values({
      studentId: input.studentId,
      clubId,
      categoryId: input.categoryId,
      opportunityName,
      date: input.isoDate,
      hours: Number(hours),
      status: "Approved",
      submittedAt: new Date(),
    })
    .returning({ num: loggedHours.num });

  emailStudentsLater([added]);
  refresh();
  return { success: true, requestId: added.num };
};

//--------------------------------------------------------------------------------------//
//                                        Delete                                        //
//--------------------------------------------------------------------------------------//

export const deleteClubRequest = async (clubId: number, requestId: number): Promise<ClubRequestResult> => {
  const deleted = await db
    .delete(loggedHours)
    .where(isClubRequest(clubId, requestId))
    .returning({
      num: loggedHours.num,
      emailId: sql<string | null>`case when ${loggedHours.studentEmailSendAt} > now() then ${loggedHours.studentEmailId} end`,
    });

  // A student email still waiting with this request in it goes out again without it
  if (deleted.length > 0) after(() => cancelDeletedClubEmails(deleted.map((d) => d.emailId)));
  refresh();
  return deleted.length > 0 ? { success: true } : { success: false, error: NOT_FOUND };
};

//--------------------------------------------------------------------------------------//
//                                        Email                                         //
//--------------------------------------------------------------------------------------//

// For testing: sends the daily coordinator email right away to every coordinator with a
// request waiting in this club, even when they were already emailed today.
// TODO: remove the Send Email Now button and this action before launch.
export const sendCoordinatorEmailsNow = async (clubId: number): Promise<ClubBulkResult> => {
  if (!Number.isInteger(clubId)) return { success: false, error: "Club not found." };

  const report = await sendCoordinatorEmails({ clubId, force: true });
  if (report.disabled) return { success: false, error: `Email is off. ${report.disabled}` };
  if (report.errors.length > 0) return { success: false, error: report.errors[0] };
  if (report.emails === 0) return { success: false, error: "No coordinators have requests waiting in this club." };

  refresh();
  return { success: true, changed: report.sent };
};
