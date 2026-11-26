"use client";

import { useState } from "react";
import PageTitle from "@/app/components/pageTitle";
import StatCard from "@/app/components/statCard";
import Tabs from "@/app/components/tabs";
import MyEventRow, { myEventStatus } from "@/app/components/myEventRow";
import EmptyState from "@/app/components/emptyState";
import "@/app/css/student.css";

import type { AttendanceStatus, MyEvent } from "@/actions/events";

type MyEventsUIProps = {
  /** Soonest first. */
  events: MyEvent[];
  /** The school's date, ISO ("2026-11-25"). Today's events are still upcoming. */
  today: string;
};

export default function MyEventsUI({ events, today }: MyEventsUIProps) {
  const [tab, setTab] = useState("upcoming");

  const upcoming = events.filter((e) => e.date >= today);
  const past = events.filter((e) => e.date < today).reverse();

  const countOf = (status: AttendanceStatus) => past.filter((e) => myEventStatus(e) === status).length;
  const attended = countOf("Present") + countOf("Late");
  const shown = tab === "upcoming" ? upcoming : past;

  return (
    <div className="my-events">
      {/* Header */}
      <PageTitle
        align="left"
        subtitle="Bring your student ID to check in. If there are two times, go to one."
        style={{ margin: 0 }}
      >
        My Events
      </PageTitle>

      {/* Stats */}
      <div className="my-events-stats">
        <StatCard label="Attended" value={`${attended} of ${past.length}`} icon="check-circle-fill" />
        <StatCard label="Late" value={String(countOf("Late"))} icon="clock-history" />
        <StatCard label="Excused" value={String(countOf("Excused"))} icon="info-circle-fill" />
        <StatCard label="Missed" value={String(countOf("Absent"))} icon="x-circle-fill" />
      </div>

      {/* Body */}
      <Tabs
        ariaLabel="Events"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "upcoming", label: "Upcoming", count: upcoming.length },
          { value: "past", label: "Past", count: past.length },
        ]}
      />

      {shown.length === 0 ? (
        <EmptyState
          icon="calendar-x"
          message={
            tab === "upcoming"
              ? "You have no required club events coming up."
              : "Events you were required to attend will show up here with your attendance."
          }
        />
      ) : (
        <div>
          {shown.map((e) => (
            <MyEventRow key={e.eventId} event={e} variant={tab === "upcoming" ? "upcoming" : "past"} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}
