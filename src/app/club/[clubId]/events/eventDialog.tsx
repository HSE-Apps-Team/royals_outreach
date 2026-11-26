"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import "bootstrap-icons/font/bootstrap-icons.css";
import ModalShell from "@/app/components/ModalShell";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import SaveButton from "@/app/components/saveButton";
import IconButton from "@/app/components/iconButton";
import Input from "@/app/components/input";
import Checkbox from "@/app/components/checkbox";
import "@/app/css/events.css";
import { useToast } from "@/app/context/ToastContext";
import { plural } from "@/lib/plural";

import {
  deleteClubEvent,
  saveClubEvent,
  type ClubEventSummary,
  type EventGroupOption,
} from "@/actions/events";

type EventDialogProps = {
  clubId: number;
  /** Null to create an event. */
  event: ClubEventSummary | null;
  groups: EventGroupOption[];
  onClose: () => void;
};

type DraftTime = {
  /** Stable React key; new times have no timeId yet. */
  key: number;
  timeId: number | null;
  label: string;
  startTime: string;
  endTime: string;
  location: string;
};

const blankTime = (key: number, location = ""): DraftTime => ({
  key,
  timeId: null,
  label: "",
  startTime: "",
  endTime: "",
  location,
});

const endsBeforeStart = (t: DraftTime) => !!t.startTime && !!t.endTime && t.endTime <= t.startTime;

export default function EventDialog({ clubId, event, groups, onClose }: EventDialogProps) {
  const { showToast } = useToast();
  const isEdit = event !== null;

  const nextKey = useRef(event?.times.length ?? 1);
  const [name, setName] = useState(event?.name ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [date, setDate] = useState(event?.date ?? "");
  const [times, setTimes] = useState<DraftTime[]>(() =>
    event ? event.times.map((t, key) => ({ key, ...t })) : [blankTime(0)],
  );
  const [groupIds, setGroupIds] = useState<number[]>(() => event?.groups.map((g) => g.groupId) ?? []);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const required = groups.filter((g) => groupIds.includes(g.groupId)).reduce((sum, g) => sum + g.memberCount, 0);
  const valid =
    !!name.trim() &&
    !!date &&
    groupIds.length > 0 &&
    times.length > 0 &&
    times.every((t) => t.startTime && t.endTime && !endsBeforeStart(t) && t.location.trim());

  const close = () => {
    if (!saving) onClose();
  };

  const setTime = (key: number, field: keyof Omit<DraftTime, "key" | "timeId">, value: string) =>
    setTimes((current) => current.map((t) => (t.key === key ? { ...t, [field]: value } : t)));

  const addTime = () => setTimes((current) => [...current, blankTime(nextKey.current++, current[0]?.location ?? "")]);

  const toggleGroup = (groupId: number, on: boolean) =>
    setGroupIds((current) => (on ? [...current, groupId] : current.filter((id) => id !== groupId)));

  const handleSave = async () => {
    if (!valid || saving) return;

    setSaving(true);
    try {
      const result = await saveClubEvent(clubId, {
        eventId: event?.eventId ?? null,
        name,
        description,
        date,
        times: times.map(({ timeId, label, startTime, endTime, location }) => ({
          timeId,
          label,
          startTime,
          endTime,
          location,
        })),
        groupIds,
      });
      if (result.success) {
        showToast(isEdit ? "Event saved." : "Event created. Assigned members can see it now.", "success");
        onClose();
      } else {
        showToast(result.error, "danger");
      }
    } catch {
      showToast("Could not save this event. Please try again.", "danger");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event || saving) return;

    setSaving(true);
    try {
      const result = await deleteClubEvent(clubId, event.eventId);
      if (result.success) {
        showToast("Event deleted.", "success");
        setConfirmingDelete(false);
        onClose();
      } else {
        showToast(result.error, "danger");
      }
    } catch {
      showToast("Could not delete this event. Please try again.", "danger");
    } finally {
      setSaving(false);
    }
  };

  // The confirm replaces the dialog instead of stacking on it, so only one focus trap is live.
  // The draft lives here, so Cancel brings the dialog back as it was.
  if (confirmingDelete && event) {
    return (
      <ConfirmDialog
        title="Delete Event"
        message={`Delete ${event.name}? Its attendance record will be deleted too.`}
        confirmLabel={saving ? "Deleting..." : "Delete Event"}
        onConfirm={handleDelete}
        onClose={() => !saving && setConfirmingDelete(false)}
      />
    );
  }

  return (
    <ModalShell
      title={isEdit ? "Edit Event" : "Create Event"}
      width="960px"
      className="event-dialog-shell"
      onClose={close}
      footer={
        <>
          {isEdit && (
            <SaveButton
              variant="secondary"
              icon="trash"
              className="event-dialog-delete"
              onClick={() => setConfirmingDelete(true)}
              disabled={saving}
            >
              Delete Event
            </SaveButton>
          )}
          <SaveButton variant="secondary" onClick={close} disabled={saving}>
            Cancel
          </SaveButton>
          <SaveButton onClick={handleSave} disabled={!valid || saving}>
            {saving ? "Saving..." : isEdit ? "Save Event" : "Create Event"}
          </SaveButton>
        </>
      }
    >
      <div className="event-dialog">
        <div className="event-dialog-row">
          <Input
            label="Event Name"
            placeholder="e.g. December General Meeting"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <Input
          label="Description (Optional)"
          multiline
          rows={2}
          placeholder="What members should know or bring."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {/* Times */}
        <fieldset className="event-dialog-section">
          <legend className="event-dialog-heading">Event Times</legend>
          <p className="event-dialog-help">
            Add a second time if you hold the same meeting twice, like before and after school. Members only need to
            come to one.
          </p>
          <div className="event-dialog-times">
            {times.map((t, i) => (
              <div key={t.key} className="event-dialog-time" role="group" aria-label={`Time ${i + 1}`}>
                <div className="event-dialog-time-header">
                  <span className="event-dialog-time-title">Time {i + 1}</span>
                  {times.length > 1 && (
                    <IconButton
                      icon="trash"
                      label={`Remove Time ${i + 1}`}
                      size={20}
                      onClick={() => setTimes((current) => current.filter((x) => x.key !== t.key))}
                    />
                  )}
                </div>
                <div className="event-dialog-time-fields">
                  <Input
                    label="Label (Optional)"
                    placeholder="e.g. Before School"
                    value={t.label}
                    onChange={(e) => setTime(t.key, "label", e.target.value)}
                  />
                  <Input
                    label="Location"
                    placeholder="e.g. Room C120"
                    value={t.location}
                    onChange={(e) => setTime(t.key, "location", e.target.value)}
                    required
                  />
                  <Input
                    label="Start"
                    type="time"
                    value={t.startTime}
                    onChange={(e) => setTime(t.key, "startTime", e.target.value)}
                    required
                  />
                  <Input
                    label="End"
                    type="time"
                    value={t.endTime}
                    error={endsBeforeStart(t) ? "Ends before it starts." : undefined}
                    onChange={(e) => setTime(t.key, "endTime", e.target.value)}
                    required
                  />
                </div>
              </div>
            ))}
          </div>
          <SaveButton variant="ghost" size="sm" icon="plus-circle" className="event-dialog-add" onClick={addTime}>
            Add Another Time
          </SaveButton>
        </fieldset>

        {/* Groups */}
        <fieldset className="event-dialog-section">
          <legend className="event-dialog-heading">Assigned Groups</legend>
          <p className="event-dialog-help">
            Everyone in these member groups is required to come and sees this event on their homepage.
          </p>
          {groups.length === 0 ? (
            <p className="event-dialog-note">
              This club has no member groups yet.{" "}
              <Link href={`/club/${clubId}/groups`}>Create a member group</Link> first, then assign it here.
            </p>
          ) : (
            <>
              <div className="event-dialog-groups">
                {groups.map((g) => (
                  <Checkbox
                    key={g.groupId}
                    label={g.groupName}
                    description={plural(g.memberCount, "member")}
                    checked={groupIds.includes(g.groupId)}
                    onChange={(on) => toggleGroup(g.groupId, on)}
                  />
                ))}
              </div>
              <div className="event-dialog-expected" aria-live="polite">
                {groupIds.length > 0
                  ? `${plural(required, "member")} will be required to come.`
                  : "Pick at least one group."}
              </div>
            </>
          )}
        </fieldset>
      </div>
    </ModalShell>
  );
}
