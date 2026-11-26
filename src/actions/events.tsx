"use server";

import { db } from "@/db";
import {
  clubData,
  clubEventAttendance,
  clubEventGroups,
  clubEventTimes,
  clubEvents,
  clubMemberGroups,
  studentClubGroupAssignment,
  studentClubMembership,
  studentUserData,
} from "@/db/schema";
import { and, asc, count, countDistinct, eq, ilike, inArray, notInArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { refresh } from "next/cache";
import { CURRENT_STUDENT_ID } from "@/lib/currentStudent";
import { schoolToday } from "@/lib/schoolDate";
import { normalizeId, scannedStudentId } from "@/lib/scannerIds";

export type AttendanceStatus = "Present" | "Late" | "Excused" | "Absent";

/** How the exec marked them: the ID scanner, the search box, or a status button on the roster. */
export type CheckInMethod = "Scanned" | "Search" | "Manual";

export type ClubEventTime = {
  timeId: number;
  /** e.g. "Before School"; "" when the time has no label. */
  label: string;
  /** 24-hour "HH:MM". */
  startTime: string;
  endTime: string;
  location: string;
};

export type ClubEventGroup = {
  groupId: number;
  groupName: string;
};

export type EventAttendance = {
  status: AttendanceStatus;
  /** The time they came to, for Present and Late. */
  timeId: number | null;
  method: CheckInMethod;
  isWalkIn: boolean;
  /** ISO timestamp. */
  markedAt: string;
};

export type StatusCounts = Record<AttendanceStatus, number>;

/** An event on the club panel's Events list. */
export type ClubEventSummary = {
  eventId: number;
  name: string;
  description: string;
  /** ISO date, e.g. "2026-12-02". */
  date: string;
  times: ClubEventTime[];
  groups: ClubEventGroup[];
  /** Everyone on the roster: assigned members plus anyone marked (walk ins). */
  total: number;
  counts: StatusCounts;
};

/** A student on an event's roster or in a check in search. */
export type RosterStudent = {
  studentId: number;
  fName: string;
  lName: string;
  email: string;
  /** Their member group in this club (at most one), or null. */
  groupName: string | null;
  /** An active member in one of the event's groups. Anyone else is a walk in. */
  isAssigned: boolean;
  attendance: EventAttendance | null;
};

export type ClubEventDetail = Omit<ClubEventSummary, "total" | "counts"> & {
  roster: RosterStudent[];
};

/** A group in the Create / Edit Event dialog. */
export type EventGroupOption = ClubEventGroup & {
  /** Active members, who would be required to come. */
  memberCount: number;
};

export type ClubEventTimeInput = {
  /** Null for a time added in the dialog. */
  timeId: number | null;
  label: string;
  startTime: string;
  endTime: string;
  location: string;
};

export type ClubEventInput = {
  /** Null to create an event. */
  eventId: number | null;
  name: string;
  description: string;
  /** ISO date, e.g. "2026-12-02". */
  date: string;
  times: ClubEventTimeInput[];
  groupIds: number[];
};

export type MarkAttendanceInput = {
  status: AttendanceStatus;
  timeId: number | null;
  method: CheckInMethod;
  /** The exec agreed to add a student outside the event's groups. */
  isWalkIn: boolean;
};

/** An event on the student's homepage and My Events page. */
export type MyEvent = {
  eventId: number;
  clubId: number;
  clubName: string;
  name: string;
  description: string;
  /** ISO date, e.g. "2026-12-02". */
  date: string;
  times: ClubEventTime[];
  /** The student's group that the event is assigned to, or null for a walk in. */
  groupName: string | null;
  attendance: EventAttendance | null;
};

export type EventResult = { success: true } | { success: false; error: string };

export type SaveEventResult = { success: true; eventId: number } | { success: false; error: string };

export type MarkAttendanceResult =
  | { success: true; attendance: EventAttendance; alreadyCheckedIn: boolean }
  | { success: false; error: string; notAssigned?: boolean };

export type MarkRestAbsentResult = { success: true; changed: number } | { success: false; error: string };

export type CheckInLookup =
  | { success: true; kind: "students"; students: RosterStudent[] }
  | { success: true; kind: "student"; student: RosterStudent }
  | { success: true; kind: "notMember"; scannedId: string }
  | { success: false; error: string };

const STATUSES: AttendanceStatus[] = ["Present", "Late", "Excused", "Absent"];
const METHODS: CheckInMethod[] = ["Scanned", "Search", "Manual"];

const MAX_NAME = 120;
const MAX_DESCRIPTION = 1000;
const MAX_LABEL = 40;
const MAX_LOCATION = 120;
const MAX_TIMES = 6;
const SEARCH_LIMIT = 6;

const EVENT_NOT_FOUND = "This event no longer exists. The list has been updated.";

//--------------------------------------------------------------------------------------//
//                                   Other Functions                                    //
//--------------------------------------------------------------------------------------//

const isClubEvent = (clubId: number, eventId: number) =>
  and(eq(clubEvents.eventId, eventId), eq(clubEvents.clubId, clubId));

const clubEventIds = (clubId: number) =>
  db.select({ eventId: clubEvents.eventId }).from(clubEvents).where(eq(clubEvents.clubId, clubId));

const IS_ACTIVE_MEMBER = sql`coalesce(${studentClubMembership.membership_status}, true)`;

const isId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;

const emptyCounts = (): StatusCounts => ({ Present: 0, Late: 0, Excused: 0, Absent: 0 });

// Postgres time comes back as "07:15:00"
const hhmm = (value: string | null) => (value ?? "").slice(0, 5);

const toTime = (t: typeof clubEventTimes.$inferSelect): ClubEventTime => ({
  timeId: t.timeId,
  label: t.label ?? "",
  startTime: hhmm(t.startTime),
  endTime: hhmm(t.endTime),
  location: t.location,
});

const toAttendance = (row: typeof clubEventAttendance.$inferSelect): EventAttendance => ({
  status: row.status as AttendanceStatus,
  timeId: row.timeId,
  method: row.method as CheckInMethod,
  isWalkIn: row.isWalkIn,
  markedAt: row.markedAt.toISOString(),
});

const groupBy = <T, K>(items: T[], key: (item: T) => K) => {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
};

// Times and groups for several events at once, keyed by event.
const timesAndGroups = async (eventIds: number[]) => {
  const [times, groups] = await Promise.all([
    db
      .select()
      .from(clubEventTimes)
      .where(inArray(clubEventTimes.eventId, eventIds))
      .orderBy(asc(clubEventTimes.sortOrder), asc(clubEventTimes.timeId)),
    db
      .select({ eventId: clubEventGroups.eventId, groupId: clubMemberGroups.groupId, groupName: clubMemberGroups.groupName })
      .from(clubEventGroups)
      .innerJoin(clubMemberGroups, eq(clubMemberGroups.groupId, clubEventGroups.groupId))
      .where(inArray(clubEventGroups.eventId, eventIds))
      .orderBy(asc(clubMemberGroups.groupName)),
  ]);

  const timesByEvent = groupBy(times, (t) => t.eventId);
  const groupsByEvent = groupBy(groups, (g) => g.eventId);
  return {
    timesFor: (eventId: number) => (timesByEvent.get(eventId) ?? []).map(toTime),
    groupsFor: (eventId: number) =>
      (groupsByEvent.get(eventId) ?? []).map((g) => ({ groupId: g.groupId, groupName: g.groupName ?? "" })),
  };
};

// Active club members in each event's groups. This is the expected roster, worked out now so
// group changes made after the event was created still count.
const assignedStudents = async (clubId: number, eventIds: number[]) => {
  const rows = await db
    .selectDistinct({ eventId: clubEventGroups.eventId, studentId: studentClubGroupAssignment.studentId })
    .from(clubEventGroups)
    .innerJoin(studentClubGroupAssignment, eq(studentClubGroupAssignment.groupId, clubEventGroups.groupId))
    .innerJoin(
      studentClubMembership,
      and(
        eq(studentClubMembership.studentId, studentClubGroupAssignment.studentId),
        eq(studentClubMembership.clubId, clubId),
      ),
    )
    .where(and(inArray(clubEventGroups.eventId, eventIds), IS_ACTIVE_MEMBER));

  const byEvent = new Map<number, Set<number>>();
  for (const row of rows) {
    if (row.studentId === null) continue;
    byEvent.set(row.eventId, (byEvent.get(row.eventId) ?? new Set()).add(row.studentId));
  }
  return (eventId: number) => byEvent.get(eventId) ?? new Set<number>();
};

// Names, group, assignment and attendance for the given students at one event.
const describeStudents = async (clubId: number, eventId: number, studentIds: number[]): Promise<RosterStudent[]> => {
  if (studentIds.length === 0) return [];

  const [students, groups, eventGroups, activeMembers, rows] = await Promise.all([
    db
      .select({
        studentId: studentUserData.studentId,
        fName: studentUserData.fName,
        lName: studentUserData.lName,
        email: studentUserData.email,
      })
      .from(studentUserData)
      .where(inArray(studentUserData.studentId, studentIds)),
    // Each student is in at most one group per club
    db
      .select({
        studentId: studentClubGroupAssignment.studentId,
        groupId: clubMemberGroups.groupId,
        groupName: clubMemberGroups.groupName,
      })
      .from(studentClubGroupAssignment)
      .innerJoin(clubMemberGroups, eq(clubMemberGroups.groupId, studentClubGroupAssignment.groupId))
      .where(and(eq(clubMemberGroups.clubId, clubId), inArray(studentClubGroupAssignment.studentId, studentIds))),
    db.select({ groupId: clubEventGroups.groupId }).from(clubEventGroups).where(eq(clubEventGroups.eventId, eventId)),
    db
      .select({ studentId: studentClubMembership.studentId })
      .from(studentClubMembership)
      .where(
        and(
          eq(studentClubMembership.clubId, clubId),
          inArray(studentClubMembership.studentId, studentIds),
          IS_ACTIVE_MEMBER,
        ),
      ),
    db
      .select()
      .from(clubEventAttendance)
      .where(and(eq(clubEventAttendance.eventId, eventId), inArray(clubEventAttendance.studentId, studentIds))),
  ]);

  const groupByStudent = new Map(groups.map((g) => [g.studentId, g]));
  const eventGroupIds = new Set(eventGroups.map((g) => g.groupId));
  const active = new Set(activeMembers.map((m) => m.studentId));
  const rowByStudent = new Map(rows.map((r) => [r.studentId, r]));
  const order = new Map(studentIds.map((id, i) => [id, i]));

  return students
    .map((s) => {
      const group = groupByStudent.get(s.studentId);
      const row = rowByStudent.get(s.studentId);
      return {
        studentId: s.studentId,
        fName: s.fName ?? "",
        lName: s.lName ?? "",
        email: s.email ?? "",
        groupName: group?.groupName ?? null,
        isAssigned: active.has(s.studentId) && !!group && eventGroupIds.has(group.groupId),
        attendance: row ? toAttendance(row) : null,
      };
    })
    .sort((a, b) => (order.get(a.studentId) ?? 0) - (order.get(b.studentId) ?? 0));
};

const isActiveMember = async (clubId: number, studentId: number) => {
  const [member] = await db
    .select({ studentId: studentClubMembership.studentId })
    .from(studentClubMembership)
    .where(
      and(
        eq(studentClubMembership.clubId, clubId),
        eq(studentClubMembership.studentId, studentId),
        IS_ACTIVE_MEMBER,
      ),
    );
  return !!member;
};

const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const isClockTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const clean = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ");

// Trims the input and returns the first problem, or the cleaned event.
const cleanEventInput = (input: ClubEventInput) => {
  const name = clean(input.name);
  const description = String(input.description ?? "").trim();
  const date = clean(input.date);
  const groupIds = [...new Set(Array.isArray(input.groupIds) ? input.groupIds : [])];
  const times = (Array.isArray(input.times) ? input.times : []).map((t) => ({
    timeId: isId(t?.timeId) ? t.timeId : null,
    label: clean(t?.label),
    startTime: clean(t?.startTime),
    endTime: clean(t?.endTime),
    location: clean(t?.location),
  }));

  if (!name) return "Give the event a name.";
  if (name.length > MAX_NAME) return `Keep the event name under ${MAX_NAME} characters.`;
  if (description.length > MAX_DESCRIPTION) return `Keep the description under ${MAX_DESCRIPTION} characters.`;
  if (!isIsoDate(date)) return "Choose a date.";
  if (groupIds.length === 0 || !groupIds.every(isId)) return "Assign at least one member group.";
  if (times.length === 0) return "Add at least one time.";
  if (times.length > MAX_TIMES) return `An event can have up to ${MAX_TIMES} times.`;

  for (const [i, t] of times.entries()) {
    const which = times.length > 1 ? `Time ${i + 1}` : "The event";
    if (!isClockTime(t.startTime)) return `${which} needs a start time.`;
    if (!isClockTime(t.endTime)) return `${which} needs an end time.`;
    if (t.endTime <= t.startTime) return `${which} has to end after it starts.`;
    if (!t.location) return `${which} needs a location.`;
    if (t.location.length > MAX_LOCATION) return `Keep each location under ${MAX_LOCATION} characters.`;
    if (t.label.length > MAX_LABEL) return `Keep each time label under ${MAX_LABEL} characters.`;
  }
  const kept = times.flatMap((t) => (t.timeId ? [t.timeId] : []));
  if (new Set(kept).size !== kept.length) return "A time is listed more than once.";

  return { name, description, date, groupIds, times };
};

//--------------------------------------------------------------------------------------//
//                                         Read                                         //
//--------------------------------------------------------------------------------------//

// Every event in the club with its times, groups and attendance counts. The page splits them
// into Upcoming (today and later) and Past.
export const getClubEvents = async (clubId: number): Promise<ClubEventSummary[]> => {
  const events = await db
    .select()
    .from(clubEvents)
    .where(eq(clubEvents.clubId, clubId))
    .orderBy(asc(clubEvents.date), asc(clubEvents.eventId));
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.eventId);
  const [{ timesFor, groupsFor }, assignedFor, rows] = await Promise.all([
    timesAndGroups(eventIds),
    assignedStudents(clubId, eventIds),
    db
      .select({
        eventId: clubEventAttendance.eventId,
        studentId: clubEventAttendance.studentId,
        status: clubEventAttendance.status,
      })
      .from(clubEventAttendance)
      .where(inArray(clubEventAttendance.eventId, eventIds)),
  ]);
  const rowsByEvent = groupBy(rows, (r) => r.eventId);

  return events.map((e) => {
    const marked = rowsByEvent.get(e.eventId) ?? [];
    const roster = new Set([...assignedFor(e.eventId), ...marked.map((r) => r.studentId)]);
    const counts = emptyCounts();
    for (const r of marked) counts[r.status as AttendanceStatus]++;

    return {
      eventId: e.eventId,
      name: e.name,
      description: e.description ?? "",
      date: e.date,
      times: timesFor(e.eventId),
      groups: groupsFor(e.eventId),
      total: roster.size,
      counts,
    };
  });
};

// One event and its roster: every active member of its groups, plus anyone with an attendance
// row (walk ins, and students who left a group after they were marked).
export const getClubEvent = async (clubId: number, eventId: number): Promise<ClubEventDetail | null> => {
  if (!isId(eventId)) return null;

  const [event] = await db.select().from(clubEvents).where(isClubEvent(clubId, eventId));
  if (!event) return null;

  const [{ timesFor, groupsFor }, assignedFor, rows] = await Promise.all([
    timesAndGroups([eventId]),
    assignedStudents(clubId, [eventId]),
    db
      .select({ studentId: clubEventAttendance.studentId })
      .from(clubEventAttendance)
      .where(eq(clubEventAttendance.eventId, eventId)),
  ]);
  const rosterIds = [...new Set([...assignedFor(eventId), ...rows.map((r) => r.studentId)])];
  const roster = (await describeStudents(clubId, eventId, rosterIds)).sort(
    (a, b) => a.lName.localeCompare(b.lName) || a.fName.localeCompare(b.fName),
  );

  return {
    eventId: event.eventId,
    name: event.name,
    description: event.description ?? "",
    date: event.date,
    times: timesFor(eventId),
    groups: groupsFor(eventId),
    roster,
  };
};

// The club's groups with how many active members each has, for the Assigned Groups checkboxes.
export const getEventGroupOptions = async (clubId: number): Promise<EventGroupOption[]> => {
  const rows = await db
    .select({
      groupId: clubMemberGroups.groupId,
      groupName: clubMemberGroups.groupName,
      memberCount: count(studentClubMembership.num),
    })
    .from(clubMemberGroups)
    .leftJoin(studentClubGroupAssignment, eq(studentClubGroupAssignment.groupId, clubMemberGroups.groupId))
    .leftJoin(
      studentClubMembership,
      and(
        eq(studentClubMembership.studentId, studentClubGroupAssignment.studentId),
        eq(studentClubMembership.clubId, clubId),
        IS_ACTIVE_MEMBER,
      ),
    )
    .where(eq(clubMemberGroups.clubId, clubId))
    .groupBy(clubMemberGroups.groupId, clubMemberGroups.groupName)
    .orderBy(asc(clubMemberGroups.groupName));

  return rows.map((g) => ({ groupId: g.groupId, groupName: g.groupName ?? "", memberCount: g.memberCount }));
};

// The Events badge in the club panel side nav.
export const getClubEventsTodayCount = async (clubId: number): Promise<number> => {
  const [row] = await db
    .select({ today: count() })
    .from(clubEvents)
    .where(and(eq(clubEvents.clubId, clubId), eq(clubEvents.date, schoolToday())));

  return row?.today ?? 0;
};

// Search active members by name, ID or email (up to 6), or resolve one scanned ID. Each result
// says whether the student is assigned to the event and how they are marked so far.
export const lookupCheckIn = async (
  clubId: number,
  eventId: number,
  lookup: { query: string } | { scannedId: string },
): Promise<CheckInLookup> => {
  const [event] = await db.select({ eventId: clubEvents.eventId }).from(clubEvents).where(isClubEvent(clubId, eventId));
  if (!event) return { success: false, error: EVENT_NOT_FOUND };

  // Scan
  if ("scannedId" in lookup) {
    const scannedId = normalizeId(lookup.scannedId);
    const studentId = scannedStudentId(scannedId);
    if (studentId === null || !(await isActiveMember(clubId, studentId))) {
      return { success: true, kind: "notMember", scannedId };
    }
    const [student] = await describeStudents(clubId, eventId, [studentId]);
    return student ? { success: true, kind: "student", student } : { success: true, kind: "notMember", scannedId };
  }

  // Search
  const query = clean(lookup.query).slice(0, 100);
  if (query.length < 2) return { success: true, kind: "students", students: [] };
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const matches = await db
    .select({ studentId: studentUserData.studentId })
    .from(studentClubMembership)
    .innerJoin(studentUserData, eq(studentUserData.studentId, studentClubMembership.studentId))
    .where(
      and(
        eq(studentClubMembership.clubId, clubId),
        IS_ACTIVE_MEMBER,
        or(
          ilike(sql`coalesce(${studentUserData.fName}, '') || ' ' || coalesce(${studentUserData.lName}, '')`, pattern),
          ilike(studentUserData.email, pattern),
          ilike(sql`${studentUserData.studentId}::text`, pattern),
        ),
      ),
    )
    .orderBy(asc(studentUserData.lName), asc(studentUserData.fName))
    .limit(SEARCH_LIMIT);

  const students = await describeStudents(
    clubId,
    eventId,
    matches.map((m) => m.studentId),
  );
  return { success: true, kind: "students", students };
};

// The signed-in student's events: those assigned to their groups in clubs they are active in,
// plus any event they were marked at (walk ins). The page splits them into Upcoming and Past.
export const getMyEvents = async (): Promise<MyEvent[]> => getEventsFor(CURRENT_STUDENT_ID);

const getEventsFor = async (studentId: number): Promise<MyEvent[]> => {
  const [myGroups, myRows] = await Promise.all([
    db
      .select({ groupId: studentClubGroupAssignment.groupId, groupName: clubMemberGroups.groupName })
      .from(studentClubGroupAssignment)
      .innerJoin(clubMemberGroups, eq(clubMemberGroups.groupId, studentClubGroupAssignment.groupId))
      .innerJoin(
        studentClubMembership,
        and(
          eq(studentClubMembership.clubId, clubMemberGroups.clubId),
          eq(studentClubMembership.studentId, studentId),
        ),
      )
      .where(and(eq(studentClubGroupAssignment.studentId, studentId), IS_ACTIVE_MEMBER)),
    db.select().from(clubEventAttendance).where(eq(clubEventAttendance.studentId, studentId)),
  ]);

  const groupIds = myGroups.flatMap((g) => (g.groupId === null ? [] : [g.groupId]));
  const assigned = groupIds.length
    ? await db
        .select({ eventId: clubEventGroups.eventId, groupId: clubEventGroups.groupId })
        .from(clubEventGroups)
        .where(inArray(clubEventGroups.groupId, groupIds))
    : [];

  const eventIds = [...new Set([...assigned.map((a) => a.eventId), ...myRows.map((r) => r.eventId)])];
  if (eventIds.length === 0) return [];

  const [events, { timesFor }] = await Promise.all([
    db
      .select({ event: clubEvents, clubName: clubData.clubName })
      .from(clubEvents)
      .innerJoin(clubData, eq(clubData.clubId, clubEvents.clubId))
      .where(and(inArray(clubEvents.eventId, eventIds), eq(clubData.isDeleted, false)))
      .orderBy(asc(clubEvents.date), asc(clubEvents.eventId)),
    timesAndGroups(eventIds),
  ]);

  const groupNameById = new Map(myGroups.map((g) => [g.groupId, g.groupName ?? ""]));
  const groupByEvent = new Map(assigned.map((a) => [a.eventId, groupNameById.get(a.groupId) ?? null]));
  const rowByEvent = new Map(myRows.map((r) => [r.eventId, r]));

  return events.map(({ event, clubName }) => {
    const row = rowByEvent.get(event.eventId);
    return {
      eventId: event.eventId,
      clubId: event.clubId,
      clubName: clubName ?? "",
      name: event.name,
      description: event.description ?? "",
      date: event.date,
      times: timesFor(event.eventId),
      groupName: groupByEvent.get(event.eventId) ?? null,
      attendance: row ? toAttendance(row) : null,
    };
  });
};

// The My Events badge in the student side nav: events assigned to their groups today.
export const getMyEventsTodayCount = async (): Promise<number> => {
  const [row] = await db
    .select({ today: countDistinct(clubEvents.eventId) })
    .from(clubEvents)
    .innerJoin(clubData, eq(clubData.clubId, clubEvents.clubId))
    .innerJoin(clubEventGroups, eq(clubEventGroups.eventId, clubEvents.eventId))
    .innerJoin(studentClubGroupAssignment, eq(studentClubGroupAssignment.groupId, clubEventGroups.groupId))
    .innerJoin(
      studentClubMembership,
      and(
        eq(studentClubMembership.clubId, clubEvents.clubId),
        eq(studentClubMembership.studentId, studentClubGroupAssignment.studentId),
      ),
    )
    .where(
      and(
        eq(studentClubGroupAssignment.studentId, CURRENT_STUDENT_ID),
        eq(clubEvents.date, schoolToday()),
        eq(clubData.isDeleted, false),
        IS_ACTIVE_MEMBER,
      ),
    );

  return row?.today ?? 0;
};

//--------------------------------------------------------------------------------------//
//                                         Save                                         //
//--------------------------------------------------------------------------------------//

// Creates or updates an event with its times and groups. Times keep their ids when edited, so
// attendance stays linked to the time each student came to.
export const saveClubEvent = async (clubId: number, input: ClubEventInput): Promise<SaveEventResult> => {
  // Validate
  const cleaned = cleanEventInput(input);
  if (typeof cleaned === "string") return { success: false, error: cleaned };
  const { name, description, date, groupIds, times } = cleaned;
  const eventId = input.eventId === null ? null : Number(input.eventId);
  if (eventId !== null && !isId(eventId)) return { success: false, error: EVENT_NOT_FOUND };

  const [clubGroups, existing, existingTimes] = await Promise.all([
    db
      .select({ groupId: clubMemberGroups.groupId })
      .from(clubMemberGroups)
      .where(and(eq(clubMemberGroups.clubId, clubId), inArray(clubMemberGroups.groupId, groupIds))),
    eventId === null
      ? Promise.resolve([])
      : db.select({ eventId: clubEvents.eventId }).from(clubEvents).where(isClubEvent(clubId, eventId)),
    eventId === null
      ? Promise.resolve([])
      : db.select({ timeId: clubEventTimes.timeId }).from(clubEventTimes).where(eq(clubEventTimes.eventId, eventId)),
  ]);
  if (clubGroups.length !== groupIds.length) {
    return { success: false, error: "A member group was removed by someone else. Reload the page and try again." };
  }
  if (eventId !== null && existing.length === 0) {
    refresh();
    return { success: false, error: EVENT_NOT_FOUND };
  }
  const existingTimeIds = new Set(existingTimes.map((t) => t.timeId));
  if (times.some((t) => t.timeId !== null && !existingTimeIds.has(t.timeId))) {
    return { success: false, error: "A time was removed by someone else. Reload the page and try again." };
  }

  const timeValues = (id: number) =>
    times.map((t, sortOrder) => ({
      eventId: id,
      label: t.label || null,
      startTime: t.startTime,
      endTime: t.endTime,
      location: t.location,
      sortOrder,
    }));

  // Create: the event needs its id before its times and groups can be written. neon-http has
  // no transactions, so if the batch fails the half-made event is removed again.
  if (eventId === null) {
    const [created] = await db
      .insert(clubEvents)
      .values({ clubId, name, description: description || null, date })
      .returning({ eventId: clubEvents.eventId });
    try {
      await db.batch([
        db.insert(clubEventTimes).values(timeValues(created.eventId)),
        db.insert(clubEventGroups).values(groupIds.map((groupId) => ({ eventId: created.eventId, groupId }))),
      ]);
    } catch (error) {
      await db.delete(clubEvents).where(eq(clubEvents.eventId, created.eventId));
      throw error;
    }
    refresh();
    return { success: true, eventId: created.eventId };
  }

  // Update: one batch, so the event, its times and its groups change together
  const keptTimeIds = times.flatMap((t) => (t.timeId ? [t.timeId] : []));
  const values = timeValues(eventId);
  const queries: BatchItem<"pg">[] = [
    db.update(clubEvents).set({ name, description: description || null, date }).where(isClubEvent(clubId, eventId)),
    db
      .delete(clubEventTimes)
      .where(
        keptTimeIds.length
          ? and(eq(clubEventTimes.eventId, eventId), notInArray(clubEventTimes.timeId, keptTimeIds))
          : eq(clubEventTimes.eventId, eventId),
      ),
    db.delete(clubEventGroups).where(eq(clubEventGroups.eventId, eventId)),
    db.insert(clubEventGroups).values(groupIds.map((groupId) => ({ eventId, groupId }))),
  ];
  times.forEach((t, i) => {
    if (t.timeId) {
      queries.push(
        db
          .update(clubEventTimes)
          .set(values[i])
          .where(and(eq(clubEventTimes.timeId, t.timeId), eq(clubEventTimes.eventId, eventId))),
      );
    }
  });
  const newTimes = values.filter((_, i) => !times[i].timeId);
  if (newTimes.length > 0) queries.push(db.insert(clubEventTimes).values(newTimes));

  await db.batch(queries as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
  refresh();
  return { success: true, eventId };
};

//--------------------------------------------------------------------------------------//
//                                      Attendance                                      //
//--------------------------------------------------------------------------------------//

// Marks one student, replacing any earlier status. Present and Late record which time they came
// to (the first time when none is given). A scan or search never downgrades someone already
// Present or Late; it returns their current check in with alreadyCheckedIn instead.
export const markAttendance = async (
  clubId: number,
  eventId: number,
  studentId: number,
  input: MarkAttendanceInput,
): Promise<MarkAttendanceResult> => {
  // Validate
  if (!STATUSES.includes(input?.status)) return { success: false, error: "Choose a status." };
  if (!METHODS.includes(input?.method)) return { success: false, error: "Choose how they checked in." };
  if (!isId(eventId) || !isId(studentId)) return { success: false, error: EVENT_NOT_FOUND };

  const [[event], times, member, [assigned]] = await Promise.all([
    db.select({ eventId: clubEvents.eventId }).from(clubEvents).where(isClubEvent(clubId, eventId)),
    db
      .select({ timeId: clubEventTimes.timeId })
      .from(clubEventTimes)
      .where(eq(clubEventTimes.eventId, eventId))
      .orderBy(asc(clubEventTimes.sortOrder), asc(clubEventTimes.timeId)),
    isActiveMember(clubId, studentId),
    db
      .select({ groupId: clubEventGroups.groupId })
      .from(clubEventGroups)
      .innerJoin(studentClubGroupAssignment, eq(studentClubGroupAssignment.groupId, clubEventGroups.groupId))
      .where(and(eq(clubEventGroups.eventId, eventId), eq(studentClubGroupAssignment.studentId, studentId)))
      .limit(1),
  ]);
  if (!event) {
    refresh();
    return { success: false, error: EVENT_NOT_FOUND };
  }
  if (!member) return { success: false, error: "That student is not an active member of this club." };
  if (!assigned && !input.isWalkIn) {
    return { success: false, notAssigned: true, error: "That student is not assigned to this event. Add them as a walk in." };
  }

  const cameIn = input.status === "Present" || input.status === "Late";
  let timeId: number | null = null;
  if (cameIn) {
    timeId = input.timeId ?? times[0]?.timeId ?? null;
    if (timeId !== null && !times.some((t) => t.timeId === timeId)) {
      return { success: false, error: "That event time was removed. Reload the page and try again." };
    }
  }

  // Write
  const fields = { status: input.status, timeId, method: input.method, isWalkIn: !assigned };
  const keepsCheckIn = input.method !== "Manual";
  const [saved] = await db
    .insert(clubEventAttendance)
    .values({ eventId, studentId, ...fields })
    .onConflictDoUpdate({
      target: [clubEventAttendance.eventId, clubEventAttendance.studentId],
      set: { ...fields, markedAt: sql`now()` },
      ...(keepsCheckIn ? { setWhere: sql`${clubEventAttendance.status} not in ('Present', 'Late')` } : {}),
    })
    .returning();

  if (!saved) {
    // Already Present or Late, so the scan or search left them as they were
    const [current] = await db
      .select()
      .from(clubEventAttendance)
      .where(and(eq(clubEventAttendance.eventId, eventId), eq(clubEventAttendance.studentId, studentId)));
    if (current) return { success: true, attendance: toAttendance(current), alreadyCheckedIn: true };
    return { success: false, error: "Could not save attendance. Please try again." };
  }

  refresh();
  return { success: true, attendance: toAttendance(saved), alreadyCheckedIn: false };
};

// Clicking the selected status again unmarks the student.
export const clearAttendance = async (clubId: number, eventId: number, studentId: number): Promise<EventResult> => {
  if (!isId(eventId) || !isId(studentId)) return { success: false, error: EVENT_NOT_FOUND };

  await db
    .delete(clubEventAttendance)
    .where(
      and(
        eq(clubEventAttendance.eventId, eventId),
        eq(clubEventAttendance.studentId, studentId),
        inArray(clubEventAttendance.eventId, clubEventIds(clubId)),
      ),
    );

  refresh();
  return { success: true };
};

// Marks every assigned student who has no status yet as Absent.
export const markRestAbsent = async (clubId: number, eventId: number): Promise<MarkRestAbsentResult> => {
  if (!isId(eventId)) return { success: false, error: EVENT_NOT_FOUND };

  const [[event], assignedFor, rows] = await Promise.all([
    db.select({ eventId: clubEvents.eventId }).from(clubEvents).where(isClubEvent(clubId, eventId)),
    assignedStudents(clubId, [eventId]),
    db
      .select({ studentId: clubEventAttendance.studentId })
      .from(clubEventAttendance)
      .where(eq(clubEventAttendance.eventId, eventId)),
  ]);
  if (!event) return { success: false, error: EVENT_NOT_FOUND };

  const marked = new Set(rows.map((r) => r.studentId));
  const unmarked = [...assignedFor(eventId)].filter((id) => !marked.has(id));
  if (unmarked.length === 0) return { success: true, changed: 0 };

  const inserted = await db
    .insert(clubEventAttendance)
    .values(unmarked.map((studentId) => ({ eventId, studentId, status: "Absent", method: "Manual", isWalkIn: false })))
    .onConflictDoNothing({ target: [clubEventAttendance.eventId, clubEventAttendance.studentId] })
    .returning({ studentId: clubEventAttendance.studentId });

  refresh();
  return { success: true, changed: inserted.length };
};

//--------------------------------------------------------------------------------------//
//                                        Delete                                        //
//--------------------------------------------------------------------------------------//

// Its times, groups and attendance go with it.
export const deleteClubEvent = async (clubId: number, eventId: number): Promise<EventResult> => {
  if (!isId(eventId)) return { success: false, error: EVENT_NOT_FOUND };

  const deleted = await db
    .delete(clubEvents)
    .where(isClubEvent(clubId, eventId))
    .returning({ eventId: clubEvents.eventId });

  refresh();
  return deleted.length > 0 ? { success: true } : { success: false, error: EVENT_NOT_FOUND };
};
