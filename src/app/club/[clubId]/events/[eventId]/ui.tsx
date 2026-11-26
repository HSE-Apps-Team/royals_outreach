"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import "bootstrap-icons/font/bootstrap-icons.css";
import SaveButton from "@/app/components/saveButton";
import SectionHead from "@/app/components/sectionHead";
import Input from "@/app/components/input";
import Select from "@/app/components/select";
import Switch from "@/app/components/switch";
import Badge from "@/app/components/badge";
import WalkInDialog from "./WalkInDialog";
import "@/app/css/club.css";
import "@/app/css/eventAttendance.css";
import { useToast } from "@/app/context/ToastContext";
import { downloadSheet } from "@/lib/excel";
import {
  ATTENDANCE_STATUSES,
  STATUS_TONES,
  checkInLine,
  eventLongDate,
  eventTimeLine,
  eventTimeName,
  eventTimeOption,
} from "@/lib/eventFormat";
import { fullName, initials } from "@/lib/personName";
import { plural } from "@/lib/plural";
import {
  clearAttendance,
  lookupCheckIn,
  markAttendance,
  markRestAbsent,
  type AttendanceStatus,
  type CheckInMethod,
  type ClubEventDetail,
  type EventAttendance,
  type MarkAttendanceResult,
  type RosterStudent,
} from "@/actions/events";

// The scanner pulls in ZXing, so it only loads in the browser when the exec opens it
const AttendanceScanner = dynamic(() => import("./AttendanceScanner"), { ssr: false });

type EventAttendanceUIProps = {
  clubId: number;
  clubName: string;
  event: ClubEventDetail;
  /** The school's date, for the Today chip. */
  today: string;
};

type Filter = "all" | AttendanceStatus | "none";

type Prompt = {
  student: RosterStudent;
  source: "scan" | "search";
  /** Answers the scanner, which waits paused for the choice. */
  resolve?: (add: boolean) => void;
};

const STAT_DEFS: { value: Exclude<Filter, "all">; label: string; icon: string }[] = [
  { value: "Present", label: "Present", icon: "check-circle-fill" },
  { value: "Late", label: "Late", icon: "clock-history" },
  { value: "Excused", label: "Excused", icon: "info-circle-fill" },
  { value: "Absent", label: "Absent", icon: "x-circle-fill" },
  { value: "none", label: "Not Marked", icon: "dash-circle" },
];

const SEARCH_DELAY_MS = 250;

const cameIn = (attendance: EventAttendance | null) =>
  attendance?.status === "Present" || attendance?.status === "Late";

const students = (n: number) => `${n} ${n === 1 ? "student" : "students"}`;

export default function EventAttendanceUI({ clubId, clubName, event, today }: EventAttendanceUIProps) {
  const { showToast } = useToast();
  const searchId = useId();

  // The server's roster replaces local edits whenever the page refreshes
  const [roster, setRoster] = useState(event.roster);
  const [serverRoster, setServerRoster] = useState(event.roster);
  if (event.roster !== serverRoster) {
    setServerRoster(event.roster);
    setRoster(event.roster);
  }

  const [filter, setFilter] = useState<Filter>("all");
  const [lateMode, setLateMode] = useState(false);
  const [timeId, setTimeId] = useState<number | null>(event.times[0]?.timeId ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ query: string; students: RosterStudent[] } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [restBusy, setRestBusy] = useState(false);

  // The latest roster for async handlers, and a counter per student so only the newest
  // change to a student can roll back or overwrite their row
  const rosterRef = useRef(roster);
  const versionsRef = useRef(new Map<number, number>());
  useEffect(() => {
    rosterRef.current = roster;
  });

  const multi = event.times.length > 1;
  const currentTimeId = event.times.some((t) => t.timeId === timeId) ? timeId : (event.times[0]?.timeId ?? null);
  const newStatus: AttendanceStatus = lateMode ? "Late" : "Present";

  //--------------------------------------------------------------------------------------//
  //                                        Counts                                        //
  //--------------------------------------------------------------------------------------//

  const counts = useMemo(() => {
    const c: Record<AttendanceStatus, number> = { Present: 0, Late: 0, Excused: 0, Absent: 0 };
    for (const r of roster) if (r.attendance) c[r.attendance.status]++;
    return c;
  }, [roster]);
  const unmarked = roster.filter((r) => !r.attendance);
  const walkIns = roster.filter((r) => r.attendance?.isWalkIn).length;
  const total = roster.length;

  // Unmarked students first, then by name
  const shown = roster
    .filter((r) => filter === "all" || (filter === "none" ? !r.attendance : r.attendance?.status === filter))
    .sort(
      (a, b) =>
        Number(!!a.attendance) - Number(!!b.attendance) || a.lName.localeCompare(b.lName) || a.fName.localeCompare(b.fName),
    );

  //--------------------------------------------------------------------------------------//
  //                                        Search                                        //
  //--------------------------------------------------------------------------------------//

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await lookupCheckIn(clubId, event.eventId, { query: q });
        if (cancelled) return;
        if (!found.success) showToast(found.error, "danger");
        else if (found.kind === "students") setResults({ query: q, students: found.students });
      } catch {
        if (!cancelled) showToast("Could not search members. Please try again.", "danger");
      }
    }, SEARCH_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, clubId, event.eventId, showToast]);

  // Results show the roster's latest status for students already on it
  const trimmedQuery = query.trim();
  const searchDone = trimmedQuery.length >= 2 && results?.query === trimmedQuery;
  const shownResults = searchDone
    ? results.students.map((s) => {
        const onRoster = roster.find((r) => r.studentId === s.studentId);
        return onRoster ? { ...s, attendance: onRoster.attendance } : s;
      })
    : [];

  //--------------------------------------------------------------------------------------//
  //                                        Marking                                       //
  //--------------------------------------------------------------------------------------//

  const nextVersion = (studentId: number) => {
    const version = (versionsRef.current.get(studentId) ?? 0) + 1;
    versionsRef.current.set(studentId, version);
    return version;
  };
  const isLatest = (studentId: number, version: number) => versionsRef.current.get(studentId) === version;

  // Sets a student's attendance, adding them to the roster when they are a new walk in
  const applyAttendance = (student: RosterStudent, attendance: EventAttendance | null) => {
    setRoster((previous) =>
      previous.some((r) => r.studentId === student.studentId)
        ? previous.map((r) => (r.studentId === student.studentId ? { ...r, attendance } : r))
        : [...previous, { ...student, attendance }],
    );
  };

  // Puts a student back as they were before a failed change
  const rollBack = (student: RosterStudent, before: RosterStudent | undefined) => {
    if (before) applyAttendance(student, before.attendance);
    else setRoster((previous) => previous.filter((r) => r.studentId !== student.studentId));
  };

  // Optimistic mark with rollback, as on the Royal Rumble attendance page
  const markStudent = async (
    student: RosterStudent,
    status: AttendanceStatus,
    method: CheckInMethod,
    isWalkIn: boolean,
    { toastOnError = true } = {},
  ): Promise<MarkAttendanceResult> => {
    const id = student.studentId;
    const before = rosterRef.current.find((r) => r.studentId === id);
    const version = nextVersion(id);
    const statusTimeId = status === "Present" || status === "Late" ? currentTimeId : null;

    // A scan or search never replaces someone already checked in, so only show it when it will save
    if (method === "Manual" || !cameIn(before?.attendance ?? null)) {
      applyAttendance(student, {
        status,
        timeId: statusTimeId,
        method,
        isWalkIn: !student.isAssigned,
        markedAt: new Date().toISOString(),
      });
    }

    let result: MarkAttendanceResult;
    try {
      result = await markAttendance(clubId, event.eventId, id, { status, timeId: statusTimeId, method, isWalkIn });
    } catch {
      result = { success: false, error: "Could not save attendance. Please try again." };
    }

    if (isLatest(id, version)) {
      if (result.success) applyAttendance(student, result.attendance);
      else rollBack(student, before);
    }
    if (!result.success && toastOnError) showToast(result.error, "danger");
    return result;
  };

  const clearStudent = async (student: RosterStudent) => {
    const id = student.studentId;
    const before = rosterRef.current.find((r) => r.studentId === id);
    const version = nextVersion(id);
    applyAttendance(student, null);

    let ok = false;
    try {
      ok = (await clearAttendance(clubId, event.eventId, id)).success;
    } catch {
      ok = false;
    }
    if (!ok) {
      if (isLatest(id, version)) rollBack(student, before);
      showToast(`Could not clear attendance for ${fullName(student)}.`, "danger");
    }
  };

  // Clicking the selected status again unmarks the student
  const handleStatus = (student: RosterStudent, status: AttendanceStatus) => {
    if (student.attendance?.status === status) clearStudent(student);
    else markStudent(student, status, "Manual", !student.isAssigned);
  };

  const handleSearchMark = async (student: RosterStudent) => {
    if (!student.isAssigned && !student.attendance?.isWalkIn) {
      setPrompt({ student, source: "search" });
      return;
    }
    const result = await markStudent(student, newStatus, "Search", !student.isAssigned);
    if (!result.success) return;
    setQuery("");
    showToast(
      result.alreadyCheckedIn
        ? `${fullName(student)} is already checked in.`
        : `${fullName(student)} marked ${result.attendance.status.toLowerCase()}.`,
      "success",
    );
  };

  const handleMarkRestAbsent = async () => {
    const targets = rosterRef.current.filter((r) => !r.attendance && r.isAssigned);
    if (targets.length === 0 || restBusy) return;

    setRestBusy(true);
    const versions = new Map(targets.map((t) => [t.studentId, nextVersion(t.studentId)]));
    for (const t of targets) {
      applyAttendance(t, {
        status: "Absent",
        timeId: null,
        method: "Manual",
        isWalkIn: false,
        markedAt: new Date().toISOString(),
      });
    }

    try {
      const result = await markRestAbsent(clubId, event.eventId);
      if (result.success) {
        showToast(`Marked ${students(result.changed)} absent.`, "success");
      } else {
        for (const t of targets) if (isLatest(t.studentId, versions.get(t.studentId)!)) applyAttendance(t, null);
        showToast(result.error, "danger");
      }
    } catch {
      for (const t of targets) if (isLatest(t.studentId, versions.get(t.studentId)!)) applyAttendance(t, null);
      showToast("Could not mark the rest absent. Please try again.", "danger");
    } finally {
      setRestBusy(false);
    }
  };

  //--------------------------------------------------------------------------------------//
  //                                       Walk Ins                                       //
  //--------------------------------------------------------------------------------------//

  // The scanner waits on this, paused, until the exec answers
  const askWalkIn = (student: RosterStudent) =>
    new Promise<boolean>((resolve) => setPrompt({ student, source: "scan", resolve }));

  const handlePromptAdd = async () => {
    if (!prompt) return;
    if (prompt.resolve) {
      prompt.resolve(true);
      setPrompt(null);
      return;
    }

    setPromptBusy(true);
    const result = await markStudent(prompt.student, newStatus, "Search", true);
    setPromptBusy(false);
    setPrompt(null);
    if (result.success) {
      setQuery("");
      showToast(`${fullName(prompt.student)} added as a walk in.`, "success");
    }
  };

  const handlePromptCancel = () => {
    prompt?.resolve?.(false);
    setPrompt(null);
  };

  //--------------------------------------------------------------------------------------//
  //                                        Export                                        //
  //--------------------------------------------------------------------------------------//

  const handleExport = async () => {
    const headers = ["First Name", "Last Name", "Student ID", "Email", "Group", "Status", "Time", "Check In", "Walk In"];
    const everyone = [...roster].sort((a, b) => a.lName.localeCompare(b.lName) || a.fName.localeCompare(b.fName));
    const rows = everyone.map((r) => ({
      "First Name": r.fName,
      "Last Name": r.lName,
      "Student ID": r.studentId,
      Email: r.email,
      Group: r.groupName ?? "No Group",
      Status: r.attendance?.status ?? "Not Marked",
      Time: cameIn(r.attendance) ? eventTimeName(event.times, r.attendance!.timeId) : "",
      "Check In": r.attendance ? checkInLine(r.attendance) : "",
      "Walk In": r.attendance?.isWalkIn ? "Yes" : "No",
    }));
    const safeName = event.name.replace(/[\\/:*?"<>|]+/g, "").trim() || "Event";

    try {
      await downloadSheet(rows, `${safeName} ${event.date} Attendance.xlsx`, headers);
      showToast("Attendance exported to Excel.", "success");
    } catch {
      showToast("Could not export attendance. Please try again.", "danger");
    }
  };

  //--------------------------------------------------------------------------------------//
  //                                        Render                                        //
  //--------------------------------------------------------------------------------------//

  const isToday = event.date === today;
  const statLabel = (value: Exclude<Filter, "all">) => STAT_DEFS.find((d) => d.value === value)?.label ?? value;
  const rosterHead =
    filter === "all" ? `Roster · ${plural(total, "Student")}` : `${statLabel(filter)} · ${shown.length}`;

  return (
    <div className="attendance-page">
      {/* Header */}
      <div className="club-section-eyebrow">{clubName ? `${clubName} · Club Executive Panel` : "Club Executive Panel"}</div>
      <Link href={`/club/${clubId}/events`} className="attendance-back-link">
        <i className="bi bi-arrow-left" aria-hidden="true" />
        All Events
      </Link>

      <div className="attendance-head">
        <div className="attendance-head-info">
          <div className="attendance-head-title-row">
            <h1 className="attendance-head-title">{event.name}</h1>
            {isToday && (
              <span className="attendance-chip attendance-chip-today">
                <i className="bi bi-broadcast" aria-hidden="true" />
                Today
              </span>
            )}
          </div>
          <div className="attendance-head-date">{eventLongDate(event.date)}</div>
          {event.times.map((t) => (
            <div key={t.timeId} className="attendance-head-time">
              <i className="bi bi-clock" aria-hidden="true" />
              <span>
                {t.label && <strong>{t.label}: </strong>}
                {eventTimeLine(t)}
              </span>
            </div>
          ))}
          {event.groups.length > 0 && (
            <div className="attendance-chips">
              {event.groups.map((g) => (
                <span key={g.groupId} className="attendance-chip attendance-chip-group">
                  <i className="bi bi-people-fill" aria-hidden="true" />
                  {g.groupName}
                </span>
              ))}
            </div>
          )}
          {event.description && <p className="attendance-head-desc">{event.description}</p>}
        </div>

        <div className="attendance-head-actions">
          <SaveButton variant="danger" icon="upc-scan" onClick={() => setScannerOpen(true)}>
            Launch ID Scanner
          </SaveButton>
          <SaveButton variant="secondary" icon="download" onClick={handleExport} disabled={roster.length === 0}>
            Export Attendance
          </SaveButton>
          <SaveButton variant="ghost" icon="pencil" href={`/club/${clubId}/events?edit=${event.eventId}`}>
            Edit Event
          </SaveButton>
        </div>
      </div>

      {/* Counters */}
      <div className="attendance-stats">
        {STAT_DEFS.map((d) => {
          const on = filter === d.value;
          const n = d.value === "none" ? unmarked.length : counts[d.value];
          const value = d.value === "Present" || d.value === "Late" ? `${n} / ${total}` : String(n);
          return (
            <button
              key={d.value}
              type="button"
              className={`attendance-stat attendance-stat-${d.value.toLowerCase()} ${on ? "attendance-stat-on" : ""}`.trim()}
              aria-pressed={on}
              onClick={() => setFilter(on ? "all" : d.value)}
            >
              <span className="attendance-stat-label">
                <i className={`bi bi-${d.icon}`} aria-hidden="true" /> {d.label}
              </span>
              <span className="attendance-stat-value">{value}</span>
            </button>
          );
        })}
      </div>

      {/* Take Attendance */}
      <section className="attendance-take" aria-labelledby={`${searchId}-head`}>
        <div className="attendance-take-head">
          <h2 id={`${searchId}-head`} className="attendance-take-title">
            Take Attendance
          </h2>
          <Switch label="Mark New Check Ins As Late" checked={lateMode} onChange={setLateMode} />
          {multi && (
            <Select
              label="Marking For"
              options={event.times.map((t, i) => ({ value: String(t.timeId), label: eventTimeOption(event.times, i) }))}
              value={String(currentTimeId)}
              onChange={(e) => setTimeId(Number(e.target.value))}
              className="attendance-take-time"
            />
          )}
        </div>

        <label htmlFor={searchId} className="attendance-visually-hidden">
          Search Members
        </label>
        <Input
          id={searchId}
          icon="search"
          placeholder="Search By Name, Student ID Or Email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {shownResults.length > 0 && (
          <ul className="attendance-results">
            {shownResults.map((s) => {
              const marked = cameIn(s.attendance);
              const tag = s.isAssigned ? "Assigned" : s.attendance?.isWalkIn ? "Walk In" : "Not Assigned";
              return (
                <li key={s.studentId} className="attendance-result">
                  <div className="attendance-result-text">
                    <div className="attendance-result-name">{fullName(s)}</div>
                    <div className="attendance-result-meta">
                      ID {s.studentId} · {s.email} · {s.groupName ?? "No Group"}
                    </div>
                  </div>
                  <span className={`attendance-chip ${s.isAssigned ? "attendance-chip-group" : "attendance-chip-walk-in"}`}>{tag}</span>
                  {marked ? (
                    <Badge tone={STATUS_TONES[s.attendance!.status]}>{s.attendance!.status}</Badge>
                  ) : (
                    <SaveButton
                      size="sm"
                      icon="check-lg"
                      onClick={() => handleSearchMark(s)}
                      className="attendance-result-mark"
                    >
                      Mark {newStatus}
                    </SaveButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {searchDone && shownResults.length === 0 && (
          <p className="attendance-take-empty">No club member matches &quot;{trimmedQuery}&quot;.</p>
        )}
        <p className="attendance-take-help">
          Students in the assigned groups are marked right away. Anyone else asks you first, then gets added as a walk in.
        </p>
      </section>

      {/* Roster */}
      <section>
        <SectionHead
          action={
            <div className="attendance-roster-actions">
              <SaveButton variant="ghost" size="sm" onClick={() => setFilter("all")} disabled={filter === "all"}>
                Show Everyone
              </SaveButton>
              <SaveButton
                variant="secondary"
                size="sm"
                icon="person-x"
                onClick={handleMarkRestAbsent}
                disabled={unmarked.length === 0 || restBusy}
              >
                Mark Rest Absent
              </SaveButton>
            </div>
          }
        >
          {rosterHead}
        </SectionHead>

        <div className="attendance-roster">
          <div className="attendance-roster-header" aria-hidden="true">
            <div>Student</div>
            <div>Group</div>
            <div>Check In</div>
            <div>Status</div>
          </div>

          {shown.map((r) => {
            const name = fullName(r);
            const which = multi && cameIn(r.attendance) ? eventTimeName(event.times, r.attendance!.timeId) : "";
            return (
              <div key={r.studentId} className="attendance-roster-row">
                <div className="attendance-roster-student">
                  <span className="attendance-avatar" aria-hidden="true">
                    {initials(r)}
                  </span>
                  <div className="attendance-roster-student-text">
                    <div className="attendance-roster-name">
                      {name}
                      {r.attendance?.isWalkIn && <span className="attendance-chip attendance-chip-walk-in">Walk In</span>}
                    </div>
                    <div className="attendance-roster-meta">
                      ID {r.studentId} · {r.email}
                    </div>
                  </div>
                </div>
                <div className="attendance-roster-cell" data-label="Group">
                  {r.groupName ?? "No Group"}
                </div>
                <div className="attendance-roster-cell" data-label="Check In">
                  <div className="attendance-roster-check">{checkInLine(r.attendance)}</div>
                  {which && <div className="attendance-roster-which">{which}</div>}
                </div>
                <div className="attendance-roster-status" role="group" aria-label={`Attendance for ${name}`}>
                  {ATTENDANCE_STATUSES.map((status) => {
                    const on = r.attendance?.status === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        className={`attendance-seg ${on ? `attendance-seg-on attendance-seg-${status.toLowerCase()}` : ""}`.trim()}
                        aria-pressed={on}
                        onClick={() => handleStatus(r, status)}
                      >
                        {status}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {shown.length === 0 && (
            <p className="attendance-roster-empty">
              {roster.length === 0
                ? "No one is assigned to this event yet. Assign a member group with members in it."
                : "No students match this filter."}
            </p>
          )}
        </div>
      </section>

      {/* Dialogs */}
      {scannerOpen && (
        <AttendanceScanner
          clubId={clubId}
          clubName={clubName}
          event={event}
          total={total}
          checkedIn={counts.Present + counts.Late}
          late={counts.Late}
          walkIns={walkIns}
          timeId={currentTimeId}
          onTimeChange={setTimeId}
          lateMode={lateMode}
          onLateModeChange={setLateMode}
          onMark={(student, status, method, isWalkIn) =>
            markStudent(student, status, method, isWalkIn, { toastOnError: false })
          }
          onAskWalkIn={askWalkIn}
          covered={prompt !== null}
          onClose={() => setScannerOpen(false)}
        />
      )}
      {prompt && (
        <WalkInDialog
          student={prompt.student}
          fromScan={prompt.source === "scan"}
          busy={promptBusy}
          onAdd={handlePromptAdd}
          onCancel={handlePromptCancel}
        />
      )}
    </div>
  );
}
