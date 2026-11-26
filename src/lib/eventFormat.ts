// Display helpers for club events, shared by the club panel and the student pages.
import type { AttendanceStatus, ClubEventTime, EventAttendance } from "@/actions/events";
import { formatDate } from "./formatDate";
import { formatTime, formatTimeRange } from "./formatTime";
import { schoolClockOf } from "./schoolDate";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["Present", "Late", "Excused", "Absent"];

/** Badge tone for each status. */
export const STATUS_TONES: Record<AttendanceStatus, "approved" | "pending" | "info" | "denied"> = {
  Present: "approved",
  Late: "pending",
  Excused: "info",
  Absent: "denied",
};

// The weekday of an ISO date ("2026-11-25" is a Wednesday), read as a calendar date, not a moment.
function weekday(iso: string): string {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return Number.isNaN(day) ? "" : DAYS[day];
}

// The pieces of the date block, e.g. "2026-11-25" -> { mon: "NOV", day: "25", dow: "WED" }.
export function eventDateParts(iso: string): { mon: string; day: string; dow: string } {
  const [mon = "", day = ""] = formatDate(iso, "short").split(" ");
  return { mon: mon.toUpperCase(), day, dow: weekday(iso).slice(0, 3).toUpperCase() };
}

// "Wednesday, Nov 25, 2026"
export function eventLongDate(iso: string): string {
  const date = formatDate(iso);
  return date ? `${weekday(iso)}, ${date}` : "";
}

// "7:15 AM to 7:45 AM · Room C120" (the label is shown separately, in bold)
export function eventTimeLine(time: ClubEventTime): string {
  return `${formatTimeRange(time.startTime, time.endTime)} · ${time.location}`;
}

// What a time is called in pickers and check in details: its label, or "Time 2"
export function eventTimeName(times: ClubEventTime[], timeId: number | null): string {
  const index = times.findIndex((t) => t.timeId === timeId);
  if (index < 0) return "";
  return times[index].label || `Time ${index + 1}`;
}

// The picker option for a time, e.g. "Before School · 7:15 AM"
export function eventTimeOption(times: ClubEventTime[], index: number): string {
  const time = times[index];
  return time ? `${time.label || `Time ${index + 1}`} · ${formatTime(time.startTime)}` : "";
}

// When they were marked, at the school, e.g. "2:47 PM"
export function markedTime(attendance: EventAttendance): string {
  return formatTime(schoolClockOf(new Date(attendance.markedAt)));
}

// The exec roster's check in line: "Scanned 2:47 PM", "Searched 2:47 PM" or "Marked by exec"
export function checkInLine(attendance: EventAttendance | null): string {
  if (!attendance) return "Not marked";
  if (attendance.method === "Manual") return "Marked by exec";
  return `${attendance.method === "Scanned" ? "Scanned" : "Searched"} ${markedTime(attendance)}`;
}

// The student's past event detail, e.g. "Scanned in at 2:48 PM · After School"
export function myCheckInDetail(attendance: EventAttendance | null, times: ClubEventTime[]): string {
  if (!attendance) return "Not checked in";
  if (attendance.status === "Excused") return "Excused by an exec";
  if (attendance.status === "Absent") return "Not checked in";

  const how =
    attendance.method === "Scanned"
      ? "Scanned in"
      : attendance.method === "Search"
        ? "Checked in"
        : "Marked by an exec";
  const which = times.length > 1 ? eventTimeName(times, attendance.timeId) : "";
  return [`${how} at ${markedTime(attendance)}`, which].filter(Boolean).join(" · ");
}
