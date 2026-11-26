"use client";

import { useId, useRef, type ReactNode, type RefObject } from "react";
import "bootstrap-icons/font/bootstrap-icons.css";
import SaveButton from "@/app/components/saveButton";
import { useDialogFocus } from "./dialogFocus";
import "@/app/css/eventAttendance.css";
import { fullName } from "@/lib/personName";
import type { RosterStudent } from "@/actions/events";

type WalkInDialogProps = {
  student: RosterStudent;
  /** Opened by the ID scanner, which stays paused until the exec chooses. */
  fromScan?: boolean;
  /** Turns the Add button into "Adding...". */
  busy?: boolean;
  onAdd: () => void;
  onCancel: () => void;
};

// Asks before adding a club member outside the event's groups. Shared by the search box and
// the ID scanner. Focus starts on Add As Walk In, and Escape is Don't Add.
export default function WalkInDialog({ student, fromScan = false, busy = false, onAdd, onCancel }: WalkInDialogProps) {
  const titleId = useId();
  const bodyId = useId();

  const why = student.groupName
    ? `They are in the ${student.groupName} group, which is not assigned to this event.`
    : "They are a club member but are not in any member group.";

  return (
    <CheckInPrompt
      titleId={titleId}
      bodyId={bodyId}
      tone="warning"
      icon="person-exclamation"
      title="Not Assigned To This Event"
      who={`${fullName(student)} · ID ${student.studentId}`}
      onEscape={() => !busy && onCancel()}
      actions={(primaryRef) => (
        <>
          <SaveButton variant="secondary" onClick={onCancel} disabled={busy}>
            Don&apos;t Add
          </SaveButton>
          <button
            ref={primaryRef}
            type="button"
            className="save-button"
            onClick={onAdd}
            disabled={busy}
          >
            <i className="bi bi-person-plus save-button-icon" aria-hidden="true" />
            {busy ? "Adding..." : "Add As Walk In"}
          </button>
        </>
      )}
    >
      <p>{why}</p>
      <p>Do you want to add them as a walk in?</p>
      {fromScan && <p className="attendance-prompt-note">Scanning is paused until you choose.</p>}
    </CheckInPrompt>
  );
}

type CheckInPromptProps = {
  titleId: string;
  bodyId: string;
  tone: "warning" | "danger";
  icon: string;
  title: string;
  who: string;
  onEscape: () => void;
  /** Gets the ref for the button that takes focus on open. */
  actions: (primaryRef: RefObject<HTMLButtonElement | null>) => ReactNode;
  children: ReactNode;
};

/** The popup frame shared by the walk in question and the scanner's not found message. */
export function CheckInPrompt({ titleId, bodyId, tone, icon, title, who, onEscape, actions, children }: CheckInPromptProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(panelRef, { onEscape, initialFocus: primaryRef });

  return (
    <div className="attendance-prompt-scrim">
      <div
        ref={panelRef}
        className={`attendance-prompt attendance-prompt-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="attendance-prompt-head">
          <i className={`bi bi-${icon} attendance-prompt-icon`} aria-hidden="true" />
          <div>
            <h2 id={titleId} className="attendance-prompt-title">
              {title}
            </h2>
            <div className="attendance-prompt-who">{who}</div>
          </div>
        </div>

        {/* Body */}
        <div id={bodyId} className="attendance-prompt-body">
          {children}
        </div>

        {/* Footer */}
        <div className="attendance-prompt-actions">{actions(primaryRef)}</div>
      </div>
    </div>
  );
}
