import React from "react";
import "./eventDateBlock.css";
import { eventDateParts } from "@/lib/eventFormat";

type EventDateBlockProps = {
  /** ISO date, e.g. "2026-11-25". */
  date?: string;
  /** Red instead of blue. */
  today?: boolean;
  /** "solid" for upcoming events; "outline" (no weekday) for past ones. */
  variant?: "solid" | "outline";
  className?: string;
};

export default function EventDateBlock({
  date = "2026-11-25",
  today = false,
  variant = "solid",
  className = "",
}: EventDateBlockProps) {
  const { mon, day, dow } = eventDateParts(date);
  const classes = [
    "event-date-block",
    variant === "outline" ? "event-date-block-outline" : "",
    today && variant === "solid" ? "event-date-block-today" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} aria-hidden="true">
      <div className="event-date-block-mon">{mon}</div>
      <div className="event-date-block-day">{day}</div>
      {variant === "solid" && <div className="event-date-block-dow">{dow}</div>}
    </div>
  );
}
