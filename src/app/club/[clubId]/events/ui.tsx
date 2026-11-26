"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import "bootstrap-icons/font/bootstrap-icons.css";
import ClubSectionHeader from "@/app/components/clubSectionHeader";
import SaveButton from "@/app/components/saveButton";
import IconButton from "@/app/components/iconButton";
import Tabs from "@/app/components/tabs";
import EmptyState from "@/app/components/emptyState";
import EventDateBlock from "@/app/components/eventDateBlock";
import EventDialog from "./eventDialog";
import "@/app/css/events.css";
import { eventTimeLine } from "@/lib/eventFormat";
import { plural } from "@/lib/plural";

import type { ClubEventSummary, EventGroupOption } from "@/actions/events";

type EventsUIProps = {
  clubId: number;
  clubName: string;
  /** Oldest first. */
  events: ClubEventSummary[];
  groups: EventGroupOption[];
  /** The school's date, e.g. "2026-11-25". */
  today: string;
  /** From ?edit=, opens that event's Edit Event dialog on load. */
  initialEditId: number | null;
};

type Tab = "upcoming" | "past";

// What the dialog is showing: a new event, an event being edited, or nothing
type Editing = { event: ClubEventSummary | null } | null;

export default function EventsUI({ clubId, clubName, events, groups, today, initialEditId }: EventsUIProps) {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("upcoming");
  const [editing, setEditing] = useState<Editing>(() => {
    const event = initialEditId === null ? undefined : events.find((e) => e.eventId === initialEditId);
    return event ? { event } : null;
  });

  const upcoming = events.filter((e) => e.date >= today);
  const past = events.filter((e) => e.date < today).reverse();
  const list = tab === "upcoming" ? upcoming : past;

  const closeDialog = () => {
    setEditing(null);
    // Drop ?edit= so a refresh does not open the dialog again
    if (initialEditId !== null) router.replace(`/club/${clubId}/events`, { scroll: false });
  };

  return (
    <div className="events-page">
      {/* Header */}
      <ClubSectionHeader
        title="Events"
        subtitle="Plan club meetings and take attendance at the door."
        clubName={clubName}
        actions={
          <SaveButton size="sm" icon="plus-circle" onClick={() => setEditing({ event: null })}>
            Create Event
          </SaveButton>
        }
      />

      <Tabs
        tabs={[
          { value: "upcoming", label: `Upcoming (${upcoming.length})` },
          { value: "past", label: `Past (${past.length})` },
        ]}
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        ariaLabel="Events"
      />

      {/* Body */}
      {list.length === 0 ? (
        <EmptyState
          icon="calendar-x"
          title={tab === "upcoming" ? "No Upcoming Events" : "No Past Events"}
          message={
            tab === "upcoming"
              ? "Create an event to start tracking attendance at your meetings."
              : "Events you have held will show up here with their attendance."
          }
        />
      ) : (
        <ul className="events-list">
          {list.map((event) => (
            <EventRow
              key={event.eventId}
              event={event}
              today={today}
              href={`/club/${clubId}/events/${event.eventId}`}
              onEdit={() => setEditing({ event })}
            />
          ))}
        </ul>
      )}

      {/* Dialogs */}
      {editing && (
        <EventDialog
          key={editing.event?.eventId ?? "new"}
          clubId={clubId}
          event={editing.event}
          groups={groups}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}

type EventRowProps = {
  event: ClubEventSummary;
  today: string;
  href: string;
  onEdit: () => void;
};

function EventRow({ event, today, href, onEdit }: EventRowProps) {
  const isToday = event.date === today;
  const isPast = event.date < today;
  const { Present, Late, Excused } = event.counts;
  const came = Present + Late;
  const total = event.total;
  const percent = (n: number) => `${total ? Math.round((n / total) * 100) : 0}%`;

  // Attendance only means something once the day has come
  const countLine = isPast || isToday ? `${came} of ${total} attended` : `${plural(total, "member")} required`;
  const subLine =
    isPast || isToday
      ? [
          Late > 0 && `${Late} late`,
          Excused > 0 && `${Excused} excused`,
          `${Math.max(0, total - came - Excused)} absent or unmarked`,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Attendance opens on the day";

  const buttonLabel = isPast ? "View Attendance" : "Take Attendance";

  return (
    <li className="events-row">
      <EventDateBlock date={event.date} today={isToday} />

      {/* Event */}
      <div className="events-row-main">
        <div className="events-row-title">
          <span className="events-row-name">{event.name}</span>
          {isToday && (
            <span className="events-chip events-chip-today">
              <i className="bi bi-broadcast" aria-hidden="true" />
              Today
            </span>
          )}
        </div>
        {event.times.map((time) => (
          <div key={time.timeId} className="events-row-time">
            <i className="bi bi-clock" aria-hidden="true" />
            <span>
              {time.label && <strong>{time.label}: </strong>}
              {eventTimeLine(time)}
            </span>
          </div>
        ))}
        {event.times.length > 1 && <div className="events-row-note">Members go to one of these times.</div>}
        {event.groups.length > 0 && (
          <div className="events-row-chips">
            {event.groups.map((group) => (
              <span key={group.groupId} className="events-chip">
                <i className="bi bi-people-fill" aria-hidden="true" />
                {group.groupName}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Attendance */}
      <div className="events-row-attendance">
        <div className="events-row-count">{countLine}</div>
        <div className="events-bar" role="img" aria-label={`${came} of ${total} members attended`}>
          <div className="events-bar-present" style={{ width: percent(Present) }} />
          <div className="events-bar-late" style={{ width: percent(Late) }} />
        </div>
        <div className="events-row-sub">{subLine}</div>
      </div>

      {/* Actions */}
      <div className="events-row-actions">
        <SaveButton
          size="sm"
          variant={isToday ? "danger" : isPast ? "secondary" : "primary"}
          icon={isPast ? "clipboard-data" : "clipboard-check"}
          href={href}
          className="events-row-open"
        >
          {buttonLabel}
          <span className="visually-hidden"> for {event.name}</span>
        </SaveButton>
        <IconButton icon="pencil" label={`Edit ${event.name}`} size={22} onClick={onEdit} />
      </div>
    </li>
  );
}
