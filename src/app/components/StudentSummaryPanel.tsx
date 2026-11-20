"use client";

import { useEffect, useId, useRef } from "react";
import "bootstrap-icons/font/bootstrap-icons.css";
import "../css/components.css";
import { formatHours } from "@/lib/formatHours";
import { plural } from "@/lib/plural";
import { fullName, initials, type PersonName } from "@/lib/personName";

export type StudentSummaryRequest = {
  id: number;
  opportunity: string;
  /** Display date, e.g. "Oct 25". */
  date: string;
  /** Status label, e.g. "Approved" or "Awaiting Email". */
  status: string;
  tone: "approved" | "denied" | "pending";
  hours: number;
};

type StudentSummaryPanelProps = {
  student?: PersonName;
  email?: string;
  /** Hours goal for the club; 0 hides the progress bar. */
  goal?: number;
  approvedHours?: number;
  pendingHours?: number;
  deniedCount?: number;
  /** Shown newest first; only the first 6 are listed. */
  recent?: StudentSummaryRequest[];
  /** Escape, the close button and the backdrop all call this. */
  onClose?: () => void;
};

const TONE_ICON: Record<StudentSummaryRequest["tone"], string> = {
  approved: "check-circle-fill",
  denied: "x-circle-fill",
  pending: "circle",
};

const DEFAULT_RECENT: StudentSummaryRequest[] = [
  { id: 1, opportunity: "Canned Food Drive", date: "Oct 25", status: "Pending", tone: "pending", hours: 4 },
  { id: 2, opportunity: "Tutoring Night", date: "Oct 13", status: "Approved", tone: "approved", hours: 2 },
];

/**
 * A slide-in panel from the right with a student's hours for one club. Focus moves to the
 * close button on open and returns to whatever had it (the student's name) on close.
 */
export default function StudentSummaryPanel({
  student = { fName: "Katara", lName: "Lopez" },
  email,
  goal = 20,
  approvedHours = 12,
  pendingHours = 4,
  deniedCount = 1,
  recent = DEFAULT_RECENT,
  onClose = () => {},
}: StudentSummaryPanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const name = fullName(student);
  const percent = goal > 0 ? Math.min(100, Math.round((approvedHours / goal) * 100)) : 0;

  // Latest onClose without re-running the mount effect when callers pass inline handlers
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Focus the panel and give focus back on close
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="student-summary">
      <button type="button" className="student-summary-backdrop" aria-label="Close student panel" onClick={onClose} />

      <aside className="student-summary-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {/* Header */}
        <div className="student-summary-head">
          <div className="student-summary-avatar" aria-hidden="true">
            {initials(student)}
          </div>
          <div className="student-summary-who">
            <h2 id={titleId} className="student-summary-name">
              {name}
            </h2>
            {email && <div className="student-summary-email">{email}</div>}
          </div>
          <button ref={closeButtonRef} type="button" className="student-summary-close" aria-label="Close" onClick={onClose}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        {/* Goal */}
        {goal > 0 && (
          <div>
            <div className="student-summary-goal">
              <span>Club Goal Progress</span>
              <span>
                {approvedHours.toLocaleString("en-US", { maximumFractionDigits: 2 })} of {formatHours(goal)}
              </span>
            </div>
            <div
              className="student-summary-bar"
              role="img"
              aria-label={`${formatHours(approvedHours)} of ${formatHours(goal)} toward the club goal`}
            >
              <div className="student-summary-bar-fill" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {/* Totals */}
        <div className="student-summary-stats">
          <div className="student-summary-stat student-summary-stat-approved">
            <div className="student-summary-stat-label">Approved</div>
            <div className="student-summary-stat-value">{formatHours(approvedHours)}</div>
          </div>
          <div className="student-summary-stat student-summary-stat-pending">
            <div className="student-summary-stat-label">Pending</div>
            <div className="student-summary-stat-value">{formatHours(pendingHours)}</div>
          </div>
          <div className="student-summary-stat student-summary-stat-denied">
            <div className="student-summary-stat-label">Denied</div>
            <div className="student-summary-stat-value">{plural(deniedCount, "Req", "Reqs")}</div>
          </div>
        </div>

        {/* Recent */}
        <div>
          <h3 className="student-summary-recent-title">Recent Requests</h3>
          {recent.length === 0 ? (
            <p className="student-summary-empty">No requests yet.</p>
          ) : (
            <ul className="student-summary-recent">
              {recent.slice(0, 6).map((r) => (
                <li key={r.id} className="student-summary-recent-row">
                  <i
                    className={`bi bi-${TONE_ICON[r.tone]} student-summary-tone-${r.tone}`}
                    role="img"
                    aria-label={r.status}
                  />
                  <div className="student-summary-recent-main">
                    <div className="student-summary-recent-opp">{r.opportunity}</div>
                    <div className="student-summary-recent-meta">
                      {r.date} · {r.status}
                    </div>
                  </div>
                  <div className="student-summary-recent-hours">{formatHours(r.hours)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
