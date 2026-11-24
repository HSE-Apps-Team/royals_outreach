"use server";

import { db } from "@/db";
import { categoryData, loggedHours, studentUserData } from "@/db/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { after } from "next/server";
import { coordinatorEmailFromToken } from "@/lib/coordinatorLink";
import { formatDate } from "@/lib/formatDate";
import { fullName } from "@/lib/personName";
import { schoolDateOf, schoolToday } from "@/lib/schoolDate";
import { emailCoordinatorDecision } from "@/lib/studentEmails";
import { MAX_MESSAGE_LENGTH } from "@/lib/validateLoggedHours";

/** A request waiting on the coordinator. */
export type CoordinatorRequest = {
  id: number;
  student: string;
  opportunity: string;
  /** "Sep 27, 2026" */
  date: string;
  /** "Class Of 2027", or "" when the student has no grad class. */
  gradClass: string;
  hours: number;
  studentMessage: string;
};

/** A request the coordinator already answered, with their own decision. */
export type CoordinatorDecision = {
  id: number;
  student: string;
  opportunity: string;
  /** "Sep 27" */
  date: string;
  hours: number;
  decision: "Approved" | "Denied";
  /** The message they sent with a deny. */
  message: string;
};

export type CoordinatorPageData = {
  coordinatorName: string;
  orgName: string;
  waiting: CoordinatorRequest[];
  history: CoordinatorDecision[];
  confirmedThisMonth: number;
  /** Hours across every request they approved. */
  confirmedHours: number;
};

export type CoordinatorResult = { success: true } | { success: false; error: string };

const HISTORY_LIMIT = 25;
const BAD_LINK = "This link is not valid. Open the newest email from Royals Outreach and try again.";
const ALREADY_ANSWERED = "This request was already answered or changed. The list has been updated.";

//--------------------------------------------------------------------------------------//
//                                   Other Functions                                    //
//--------------------------------------------------------------------------------------//

const isForCoordinator = (email: string) => sql`lower(${loggedHours.coordinatorEmail}) = ${email}`;

const waitingOn = (email: string, requestId: number) =>
  and(
    eq(loggedHours.num, requestId),
    isForCoordinator(email),
    eq(loggedHours.status, "Pending Email Verification"),
  );

const nameOf = (fName: string | null, lName: string | null) =>
  fullName({ fName: fName ?? "", lName: lName ?? "" }) || "Unknown Student";

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

/** Everything on the coordinator page, or null when the link is not genuine. */
export const getCoordinatorPage = async (token: string): Promise<CoordinatorPageData | null> => {
  const email = coordinatorEmailFromToken(token);
  if (!email) return null;

  const rows = await db
    .select({
      request: loggedHours,
      fName: studentUserData.fName,
      lName: studentUserData.lName,
      gradClass: studentUserData.gradClass,
    })
    .from(loggedHours)
    .leftJoin(studentUserData, eq(studentUserData.studentId, loggedHours.studentId))
    .where(isForCoordinator(email))
    .orderBy(desc(loggedHours.submittedAt), desc(loggedHours.num));

  // Waiting, oldest event first so nothing sits at the bottom
  const waiting = rows
    .filter(({ request }) => request.status === "Pending Email Verification")
    .sort((a, b) => (a.request.date ?? "").localeCompare(b.request.date ?? "") || a.request.num - b.request.num)
    .map(({ request, fName, lName, gradClass }) => ({
      id: request.num,
      student: nameOf(fName, lName),
      opportunity: request.opportunityName ?? "",
      date: formatDate(request.date),
      gradClass: gradClass ? `Class Of ${gradClass}` : "",
      hours: request.hours ?? 0,
      studentMessage: request.optionalMessage ?? "",
    }));

  // Their decisions, newest first
  const decided = rows
    .filter(({ request }) => request.coordinatorDecision === "Approved" || request.coordinatorDecision === "Denied")
    .sort((a, b) => (b.request.coordinatorDecidedAt?.getTime() ?? 0) - (a.request.coordinatorDecidedAt?.getTime() ?? 0));

  const thisMonth = schoolToday().slice(0, 7);
  const approved = decided.filter(({ request }) => request.coordinatorDecision === "Approved");

  // The newest request names the organization and coordinator the way the student typed them
  const newest = rows[0]?.request;

  return {
    coordinatorName: newest?.coordinatorName ?? "",
    orgName: newest?.orgName ?? "",
    waiting,
    history: decided.slice(0, HISTORY_LIMIT).map(({ request, fName, lName }) => ({
      id: request.num,
      student: nameOf(fName, lName),
      opportunity: request.opportunityName ?? "",
      date: formatDate(request.date, "short"),
      hours: request.hours ?? 0,
      decision: request.coordinatorDecision as "Approved" | "Denied",
      message: request.coordinatorDecision === "Denied" ? (request.denyMessage ?? "") : "",
    })),
    confirmedThisMonth: approved.filter(
      ({ request }) => request.coordinatorDecidedAt && schoolDateOf(request.coordinatorDecidedAt).startsWith(thisMonth),
    ).length,
    confirmedHours: Math.round(approved.reduce((sum, { request }) => sum + (request.hours ?? 0), 0) * 100) / 100,
  };
};

//--------------------------------------------------------------------------------------//
//                                        Review                                        //
//--------------------------------------------------------------------------------------//

// Approving finishes the email step. The request then waits on the club when its category
// needs club confirmation, and counts right away when it does not.
export const approveAsCoordinator = async (token: string, requestId: number): Promise<CoordinatorResult> => {
  const email = coordinatorEmailFromToken(token);
  if (!email) return { success: false, error: BAD_LINK };
  if (!Number.isInteger(requestId)) return { success: false, error: ALREADY_ANSWERED };

  const [row] = await db
    .select({ needsClubConfirmation: categoryData.needsClubConfirmation })
    .from(loggedHours)
    .leftJoin(categoryData, eq(categoryData.categoryId, loggedHours.categoryId))
    .where(waitingOn(email, requestId));
  if (!row) {
    refresh();
    return { success: false, error: ALREADY_ANSWERED };
  }

  const updated = await db
    .update(loggedHours)
    .set({
      status: row.needsClubConfirmation ? "Pending Club Verification" : "Approved",
      decidedAt: row.needsClubConfirmation ? null : new Date(),
      denyMessage: null,
      coordinatorDecision: "Approved",
      coordinatorDecidedAt: new Date(),
    })
    .where(waitingOn(email, requestId))
    .returning({ num: loggedHours.num });

  if (updated.length > 0) after(() => emailCoordinatorDecision(requestId));
  refresh();
  return updated.length > 0 ? { success: true } : { success: false, error: ALREADY_ANSWERED };
};

// The message is optional and only sent to the student when the coordinator denies.
export const denyAsCoordinator = async (
  token: string,
  requestId: number,
  message: string,
): Promise<CoordinatorResult> => {
  const email = coordinatorEmailFromToken(token);
  if (!email) return { success: false, error: BAD_LINK };
  if (!Number.isInteger(requestId)) return { success: false, error: ALREADY_ANSWERED };

  const denyMessage = String(message ?? "").trim();
  if (denyMessage.length > MAX_MESSAGE_LENGTH) {
    return { success: false, error: `Keep the message under ${MAX_MESSAGE_LENGTH} characters.` };
  }

  const updated = await db
    .update(loggedHours)
    .set({
      status: "Denied",
      decidedAt: new Date(),
      denyMessage: denyMessage || null,
      coordinatorDecision: "Denied",
      coordinatorDecidedAt: new Date(),
    })
    .where(waitingOn(email, requestId))
    .returning({ num: loggedHours.num });

  if (updated.length > 0) after(() => emailCoordinatorDecision(requestId));
  refresh();
  return updated.length > 0 ? { success: true } : { success: false, error: ALREADY_ANSWERED };
};

//--------------------------------------------------------------------------------------//
//                                     Development                                      //
//--------------------------------------------------------------------------------------//

/** Coordinators with requests waiting, for the dev link list. Empty in production. */
export const getCoordinatorsWaiting = async (): Promise<{ email: string; waiting: number }[]> => {
  if (process.env.NODE_ENV === "production") return [];

  const rows = await db
    .select({
      email: sql<string>`lower(${loggedHours.coordinatorEmail})`,
      waiting: sql<number>`count(*)::int`,
    })
    .from(loggedHours)
    .where(and(eq(loggedHours.status, "Pending Email Verification"), isNotNull(loggedHours.coordinatorEmail)))
    .groupBy(sql`lower(${loggedHours.coordinatorEmail})`)
    .orderBy(sql`lower(${loggedHours.coordinatorEmail})`);

  return rows;
};
