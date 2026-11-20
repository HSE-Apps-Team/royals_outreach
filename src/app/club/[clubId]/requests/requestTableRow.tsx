"use client";

import Input from "@/app/components/input";
import { formatHours } from "@/lib/formatHours";
import { initials } from "@/lib/personName";

import type { ClubRequest } from "@/actions/clubRequests";

export type RowFlag = { label: string; tip: string };

type RequestTableRowProps = {
  request: ClubRequest;
  name: string;
  categoryColor: string;
  /** Shows the status icon in the coordinator column (Approved and Denied tabs). */
  showStatusIcon: boolean;
  /** Event weekday, e.g. "Sat". */
  weekday: string;
  /** "Submitted 2 days after", "Added by club exec", or null when unknown. */
  submittedLine: string | null;
  /** Days a pending request has waited, shown from 7 on. */
  waitingDays: number | null;
  flags: RowFlag[];
  selected: boolean;
  denying: boolean;
  denyMessage: string;
  busy: boolean;
  onToggleSelect: () => void;
  onOpenStudent: () => void;
  onApprove: () => void;
  onStartDeny: () => void;
  onDenyMessageChange: (message: string) => void;
  onConfirmDeny: () => void;
  onCancelDeny: () => void;
  onEdit: () => void;
  onViewPhoto: () => void;
};

const isPending = (r: ClubRequest) =>
  r.status === "Pending Club Verification" || r.status === "Pending Email Verification";

// One short line under the coordinator about where the request stands.
function trailOf(r: ClubRequest): { text: string; tone: string } {
  switch (r.status) {
    case "Approved":
      return { text: r.coordinator ? `Verified by ${r.coordinator}` : "Approved by the club", tone: "muted" };
    case "Denied":
      return { text: r.denyMessage ? `Denied: ${r.denyMessage}` : "Denied", tone: "denied" };
    case "Pending Email Verification":
      return { text: "Waiting on coordinator email", tone: "pending" };
    default:
      return r.coordinator
        ? { text: "Verified by coordinator", tone: "verified" }
        : { text: "No email check needed", tone: "muted" };
  }
}

export default function RequestTableRow({
  request: r,
  name,
  categoryColor,
  showStatusIcon,
  weekday,
  submittedLine,
  waitingDays,
  flags,
  selected,
  denying,
  denyMessage,
  busy,
  onToggleSelect,
  onOpenStudent,
  onApprove,
  onStartDeny,
  onDenyMessageChange,
  onConfirmDeny,
  onCancelDeny,
  onEdit,
  onViewPhoto,
}: RequestTableRowProps) {
  const pending = isPending(r);
  const awaitingEmail = r.status === "Pending Email Verification";
  const label = `${name}, ${r.opportunity}`;
  const trail = trailOf(r);
  const denyId = `deny-message-${r.id}`;

  const rowClasses = [
    "club-requests-row",
    selected ? "club-requests-row-selected" : "",
    denying ? "club-requests-row-denying" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rowClasses}>
      <div className="club-requests-grid">
        {/* Select */}
        <div className="club-requests-cell-check">
          {pending && (
            <input
              type="checkbox"
              className="club-requests-checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Select ${label}`}
            />
          )}
        </div>

        {/* Student */}
        <div className="club-requests-student">
          <div className="club-requests-avatar" aria-hidden="true">
            {r.student ? initials(r.student) : "?"}
          </div>
          <div className="club-requests-student-main">
            <button
              type="button"
              className="club-requests-name"
              onClick={onOpenStudent}
              aria-label={`Open hours summary for ${name}`}
            >
              {name}
            </button>
            {(waitingDays !== null || flags.length > 0) && (
              <div className="club-requests-chips">
                {waitingDays !== null && (
                  <span className="club-requests-chip club-requests-chip-waiting">
                    <i className="bi bi-hourglass-split" aria-hidden="true" />
                    Waiting {waitingDays} days
                  </span>
                )}
                {flags.map((f) => (
                  <span key={f.label} className="club-requests-chip club-requests-chip-flag" title={f.tip}>
                    <i className="bi bi-flag-fill" aria-hidden="true" />
                    {f.label}
                    <span className="club-requests-sr">: {f.tip}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Opportunity */}
        <div className="club-requests-cell">
          <span className="club-requests-cell-label">Opportunity</span>
          <div className="club-requests-opp">
            <div className="club-requests-opp-name">{r.opportunity}</div>
            <div className="club-requests-opp-org">{r.organization || "HSE High School"}</div>
            <div className="club-requests-opp-category">
              <span className="club-requests-dot" style={{ background: categoryColor }} aria-hidden="true" />
              {r.category || "General Hours"}
            </div>
          </div>
        </div>

        {/* Date and hours */}
        <div className="club-requests-cell">
          <span className="club-requests-cell-label">Date · Hours</span>
          <div className="club-requests-when">
            <div className="club-requests-when-main">
              {r.date} · <span className="club-requests-hours">{formatHours(r.hours)}</span>
            </div>
            {weekday && <div className="club-requests-muted">{weekday}</div>}
            {submittedLine && <div className="club-requests-muted club-requests-submitted">{submittedLine}</div>}
          </div>
        </div>

        {/* Coordinator */}
        <div className="club-requests-cell">
          <span className="club-requests-cell-label">{showStatusIcon ? "Status · Coordinator" : "Coordinator"}</span>
          <div className="club-requests-coord">
            {showStatusIcon && (
              <i
                className={`bi ${r.status === "Approved" ? "bi-check-circle-fill club-requests-icon-approved" : "bi-x-circle-fill club-requests-icon-denied"} club-requests-status-icon`}
                role="img"
                aria-label={r.status}
                title={r.status}
              />
            )}
            <div className="club-requests-coord-main">
              <div className="club-requests-coord-name">{r.coordinator || "Club Approval Only"}</div>
              {r.coordinatorEmail && (
                <a className="club-requests-coord-email" href={`mailto:${r.coordinatorEmail}`}>
                  {r.coordinatorEmail}
                </a>
              )}
              <div className={`club-requests-trail club-requests-trail-${trail.tone}`}>{trail.text}</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="club-requests-actions">
          {pending && (
            <>
              <button
                type="button"
                className="club-requests-btn club-requests-btn-approve"
                onClick={onApprove}
                disabled={busy}
                aria-label={`${awaitingEmail ? "Override and approve" : "Approve"} ${label}`}
              >
                <i className="bi bi-check-lg" aria-hidden="true" />
                {awaitingEmail ? "Override" : "Approve"}
              </button>
              <button
                type="button"
                className="club-requests-btn club-requests-btn-deny"
                onClick={onStartDeny}
                disabled={busy}
                aria-expanded={denying}
                aria-controls={denying ? `deny-box-${r.id}` : undefined}
                aria-label={`Deny ${label}`}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
                Deny
              </button>
            </>
          )}
          <button
            type="button"
            className="club-requests-btn club-requests-btn-ghost"
            onClick={onEdit}
            disabled={busy}
            aria-label={`Edit ${label}`}
          >
            <i className="bi bi-pencil" aria-hidden="true" />
            {pending ? "Edit" : "Edit Or Override"}
          </button>
        </div>
      </div>

      {/* Message and photo */}
      {(r.hasPhoto || r.message) && (
        <div className="club-requests-strip">
          {r.hasPhoto && (
            <button
              type="button"
              className="club-requests-thumb"
              onClick={onViewPhoto}
              aria-label={`View photo from ${name}`}
              title="View Submitted Photo"
            >
              <i className="bi bi-image" aria-hidden="true" />
            </button>
          )}
          {r.message ? (
            <div className="club-requests-message">
              <i className="bi bi-chat-left-text" aria-hidden="true" />
              <span>{r.message}</span>
            </div>
          ) : (
            <div className="club-requests-muted">Photo attached</div>
          )}
        </div>
      )}

      {/* Inline deny */}
      {denying && (
        <div className="club-requests-deny" id={`deny-box-${r.id}`}>
          <div className="club-requests-deny-field">
            <Input
              id={denyId}
              label="Deny Message (Optional)"
              multiline
              rows={2}
              placeholder="Shown to the student so they know what to fix."
              value={denyMessage}
              onChange={(e) => onDenyMessageChange(e.target.value)}
            />
          </div>
          <div className="club-requests-deny-actions">
            <button
              type="button"
              className="club-requests-btn club-requests-btn-deny-solid"
              onClick={onConfirmDeny}
              disabled={busy}
            >
              <i className="bi bi-x-lg" aria-hidden="true" />
              Confirm Deny
            </button>
            <button type="button" className="club-requests-btn club-requests-btn-ghost" onClick={onCancelDeny}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
