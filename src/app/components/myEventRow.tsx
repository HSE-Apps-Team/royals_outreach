import React from "react";
import "bootstrap-icons/font/bootstrap-icons.css";
import EventDateBlock from "./eventDateBlock";
import Badge from "./badge";
import "./myEventRow.css";
import type { AttendanceStatus, MyEvent } from "@/actions/events";
import { STATUS_TONES, eventTimeLine, myCheckInDetail } from "@/lib/eventFormat";

type MyEventRowProps = {
  event: MyEvent;
  /** "upcoming" shows the times and group; "past" shows the student's status. */
  variant?: "upcoming" | "past";
  /** The school's date, ISO ("2026-11-25"), for the Today chip. */
  today?: string;
  className?: string;
};

// A past event without an attendance row was missed.
export const myEventStatus = (event: MyEvent): AttendanceStatus => event.attendance?.status ?? "Absent";

export default function MyEventRow({ event, variant = "upcoming", today = "", className = "" }: MyEventRowProps) {
  const isToday = event.date === today;
  const isPast = variant === "past";

  return (
    <div className={`my-event-row ${className}`.trim()}>
      <EventDateBlock date={event.date} today={isToday} variant={isPast ? "outline" : "solid"} />

      {/* Body */}
      <div className="my-event-row-body">
        <div className="my-event-row-title">
          <span className="my-event-row-name">{event.name}</span>
          {isToday && !isPast && (
            <span className="my-event-row-today">
              <i className="bi bi-broadcast" aria-hidden="true" />
              Today
            </span>
          )}
        </div>
        <div className="my-event-row-club">{event.clubName}</div>

        {isPast ? (
          <div className="my-event-row-detail">{myCheckInDetail(event.attendance, event.times)}</div>
        ) : (
          <>
            {event.times.map((time) => (
              <div key={time.timeId} className="my-event-row-time">
                <i className="bi bi-clock" aria-hidden="true" />
                <span>
                  {time.label && <span className="my-event-row-time-label">{time.label}: </span>}
                  {eventTimeLine(time)}
                </span>
              </div>
            ))}
            {event.times.length > 1 && (
              <div className="my-event-row-either">
                <i className="bi bi-signpost-split" aria-hidden="true" />
                Go to one of these times. Either one counts.
              </div>
            )}
          </>
        )}
      </div>

      {/* Aside */}
      {isPast ? (
        <Badge tone={STATUS_TONES[myEventStatus(event)]} className="my-event-row-badge">
          {myEventStatus(event)}
        </Badge>
      ) : (
        <div className="my-event-row-group">{event.groupName ? `Assigned to ${event.groupName}` : "Walk In"}</div>
      )}
    </div>
  );
}
