"use server";

import { db } from "@/db";
import { categoryData, loggedHours, registrations, signUps } from "@/db/schema";
import { and, asc, count, eq, gte, inArray, min, sql } from "drizzle-orm";
import { getClubProgress, type CategoryTotal } from "@/actions/clubProgress";
import { getClubEvents, type ClubEventSummary } from "@/actions/events";
import { formatDate } from "@/lib/formatDate";
import { formatTimeRange } from "@/lib/formatTime";
import { schoolToday } from "@/lib/schoolDate";

/** One upcoming opportunity on the Overview. */
export type OverviewOpportunity = {
  id: number;
  /** ISO date, e.g. "2026-10-17". */
  date: string;
  name: string;
  /** "10:00 AM to 12:00 PM", or empty when the opportunity has no times. */
  time: string;
  registered: number;
  /** Null when the opportunity has no slot limit. */
  slots: number | null;
};

export type ClubOverview = {
  clubName: string;
  requests: {
    /** Waiting on the club (the Hour Requests badge). */
    waiting: number;
    /** Still waiting on a coordinator's email verification. */
    emailPending: number;
    /** Date of the oldest request waiting on the club ("Sep 28"), or null when none are waiting. */
    oldest: string | null;
  };
  /** Approved hours from the members who need hours, as on Hours Progress. */
  totalHours: number;
  /** Active members. */
  members: number;
  categories: CategoryTotal[];
  /** Every event and opportunity from today on. */
  upcomingCount: number;
  /** Events happening today, with their check in counts. */
  eventsToday: ClubEventSummary[];
  /** The soonest few events after today, soonest first. */
  upcomingEvents: ClubEventSummary[];
  /** The soonest few opportunities from today on, soonest first. */
  upcoming: OverviewOpportunity[];
};

const UPCOMING_SHOWN = 3;

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

// Everything the club panel Overview shows. Null when the club does not exist.
export const getClubOverview = async (clubId: number): Promise<ClubOverview | null> => {
  const today = schoolToday();
  const isUpcoming = and(eq(categoryData.clubId, clubId), gte(signUps.date, today));

  const [progress, events, requestRows, upcomingRows, [upcomingTotal]] = await Promise.all([
    getClubProgress(clubId),
    getClubEvents(clubId),
    db
      .select({
        status: loggedHours.status,
        total: count(),
        oldest: min(loggedHours.date),
      })
      .from(loggedHours)
      .where(
        and(
          eq(loggedHours.clubId, clubId),
          inArray(loggedHours.status, ["Pending Email Verification", "Pending Club Verification"]),
        ),
      )
      .groupBy(loggedHours.status),
    db
      .select({
        id: signUps.signUpId,
        date: signUps.date,
        name: signUps.name,
        startTime: signUps.startTime,
        endTime: signUps.endTime,
        slots: signUps.slots,
        registered: sql<number>`(select count(*) from ${registrations} where ${registrations.signUpId} = ${signUps.signUpId})`.mapWith(Number),
      })
      .from(signUps)
      .innerJoin(categoryData, eq(categoryData.categoryId, signUps.categoryId))
      .where(isUpcoming)
      .orderBy(asc(signUps.date), asc(signUps.startTime), asc(signUps.signUpId))
      .limit(UPCOMING_SHOWN),
    db
      .select({ total: count() })
      .from(signUps)
      .innerJoin(categoryData, eq(categoryData.categoryId, signUps.categoryId))
      .where(isUpcoming),
  ]);
  if (!progress) return null;

  const comingEvents = events.filter((e) => e.date >= today);
  const club = requestRows.find((r) => r.status === "Pending Club Verification");
  const email = requestRows.find((r) => r.status === "Pending Email Verification");

  return {
    clubName: progress.clubName,
    requests: {
      waiting: club?.total ?? 0,
      emailPending: email?.total ?? 0,
      oldest: club?.oldest ? formatDate(club.oldest, "short") : null,
    },
    totalHours: progress.total.approved,
    members: progress.students.length,
    categories: progress.total.categories,
    upcomingCount: comingEvents.length + (upcomingTotal?.total ?? 0),
    eventsToday: comingEvents.filter((e) => e.date === today),
    upcomingEvents: comingEvents.filter((e) => e.date > today).slice(0, UPCOMING_SHOWN),
    upcoming: upcomingRows.map((o) => ({
      id: o.id,
      date: o.date ?? "",
      name: o.name ?? "",
      time: formatTimeRange(o.startTime, o.endTime),
      registered: o.registered,
      slots: o.slots,
    })),
  };
};
