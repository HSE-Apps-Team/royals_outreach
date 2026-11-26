import BannerHeader from "@/app/components/bannerHeader";
import SaveButton from "@/app/components/saveButton";
import StatCard from "@/app/components/statCard";
import SectionHead from "@/app/components/sectionHead";
import ProgressBar from "@/app/components/progressBar";
import ListRow, { ListRowDate } from "@/app/components/listRow";
import EmptyState from "@/app/components/emptyState";
import EventDateBlock from "@/app/components/eventDateBlock";
import "bootstrap-icons/font/bootstrap-icons.css";
import "@/app/css/club.css";
import { canSee, type ClubRole, type ClubSection } from "@/lib/canSee";
import { eventDateParts, eventTimeLine } from "@/lib/eventFormat";
import { formatHours } from "@/lib/formatHours";
import { plural } from "@/lib/plural";

import type { ClubOverview, OverviewOpportunity } from "@/actions/clubOverview";
import type { ClubEventSummary } from "@/actions/events";

type ClubOverviewUIProps = {
  clubId: number;
  overview: ClubOverview;
  role: ClubRole;
};

// Quick Actions in mockup order.
// TODO: Opportunities and Export are not built yet, so those two buttons 404 for now
const QUICK_ACTIONS: { label: string; icon: string; section: ClubSection }[] = [
  { label: "Review Requests", icon: "inbox", section: "requests" },
  { label: "Create Opportunity", icon: "plus-circle", section: "opportunities" },
  { label: "Add Category", icon: "tags", section: "categories" },
  { label: "Export Data", icon: "download", section: "export" },
];

// "12 / 20 Slots", or "12 Registered" when there is no limit
const slotsLabel = (o: OverviewOpportunity) =>
  o.slots ? `${o.registered} / ${o.slots} Slots` : `${o.registered} Registered`;

// "10:00 AM to 12:00 PM · Room C120", plus how many other times the event has
const firstTimeLine = (e: ClubEventSummary) => {
  const [first] = e.times;
  if (!first) return undefined;
  const more = e.times.length - 1;
  return more > 0 ? `${eventTimeLine(first)} · +${more} More` : eventTimeLine(first);
};

// "12 of 40 checked in"
const checkedInLine = (e: ClubEventSummary) => `${e.counts.Present + e.counts.Late} of ${e.total} checked in`;

export default function ClubOverviewUI({ clubId, overview, role }: ClubOverviewUIProps) {
  const { clubName, requests, totalHours, members, categories, upcomingCount, eventsToday, upcomingEvents, upcoming } =
    overview;
  const href = (section: ClubSection) => `/club/${clubId}/${section}`;
  const quickActions = QUICK_ACTIONS.filter((a) => canSee(a.section, role));

  const requestLine = [
    requests.oldest && `Oldest from ${requests.oldest}`,
    requests.emailPending > 0 && `${requests.emailPending} need email verification`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="club-overview">
      {/* Header */}
      <BannerHeader eyebrow="Club Executive Panel" title={clubName} />

      {/* Events today */}
      {canSee("events", role) &&
        eventsToday.map((e) => (
          <div key={e.eventId} className="club-overview-today">
            <EventDateBlock date={e.date} today />
            <div className="club-overview-today-text">
              <div className="club-overview-today-eyebrow">
                <i className="bi bi-broadcast" aria-hidden="true" /> Event Today
              </div>
              <h2 className="club-overview-today-title">{e.name}</h2>
              <p className="club-muted-line">{[firstTimeLine(e), checkedInLine(e)].filter(Boolean).join(" · ")}</p>
            </div>
            <SaveButton size="sm" variant="danger" icon="clipboard-check" href={`${href("events")}/${e.eventId}`}>
              Take Attendance
              <span className="visually-hidden"> for {e.name}</span>
            </SaveButton>
          </div>
        ))}

      {/* Requests waiting */}
      {canSee("requests", role) && (
        <div className="club-overview-requests">
          <span className="club-overview-requests-icon" aria-hidden="true">
            <i className={`bi bi-${requests.waiting > 0 ? "hourglass-split" : "check-lg"}`} />
          </span>
          <div className="club-overview-requests-text">
            <h2 className="club-overview-requests-title">
              {requests.waiting > 0 ? `${plural(requests.waiting, "Request")} Waiting` : "No Requests Waiting"}
            </h2>
            <p className="club-muted-line">{requestLine || "You're all caught up."}</p>
          </div>
          <SaveButton size="sm" iconRight="arrow-right" href={href("requests")}>
            Review Requests
          </SaveButton>
        </div>
      )}

      {/* Stats */}
      <div className="club-overview-stats">
        <StatCard tone="solid" label="Club Total" value={formatHours(totalHours)} />
        <StatCard label="Members" value={members.toLocaleString("en-US")} />
        <StatCard label="Upcoming" value={upcomingCount} />
      </div>

      {/* Quick actions */}
      {quickActions.length > 0 && (
        <section>
          <SectionHead>Quick Actions</SectionHead>
          <div className="club-overview-actions">
            {quickActions.map((a) => (
              <SaveButton key={a.section} size="sm" variant="secondary" icon={a.icon} href={href(a.section)}>
                {a.label}
              </SaveButton>
            ))}
          </div>
        </section>
      )}

      {/* Hours by category */}
      {canSee("progress", role) && (
        <section>
          <SectionHead>Hours By Category</SectionHead>
          {categories.length === 0 ? (
            <EmptyState size="sm" icon="tags" message="This club has no categories yet. Add one to start tracking hours." />
          ) : (
            <div className="club-overview-categories">
              {categories.map((c) => (
                <ProgressBar key={c.categoryId} label={c.name} value={c.value} goal={c.goal} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Upcoming events */}
      {canSee("events", role) && (
        <section>
          <SectionHead
            action={
              <SaveButton size="sm" variant="ghost" iconRight="arrow-right" href={href("events")}>
                All Events
              </SaveButton>
            }
          >
            Upcoming Events
          </SectionHead>
          {upcomingEvents.length === 0 ? (
            <EmptyState
              size="sm"
              icon="calendar-check"
              message={eventsToday.length > 0 ? "No more events after today." : "No upcoming events."}
            />
          ) : (
            <ul className="club-overview-list">
              {upcomingEvents.map((e) => {
                const { mon, day } = eventDateParts(e.date);
                return (
                  <ListRow
                    key={e.eventId}
                    as="li"
                    leading={<ListRowDate variant="accent" month={mon} day={day} />}
                    title={e.name}
                    subtitle={firstTimeLine(e)}
                    meta={`${plural(e.total, "Member")} Required`}
                  />
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Upcoming opportunities */}
      {canSee("opportunities", role) && (
        <section>
          <SectionHead>Upcoming Opportunities</SectionHead>
          {upcoming.length === 0 ? (
            <EmptyState size="sm" icon="calendar-event" message="No upcoming opportunities." />
          ) : (
            <ul className="club-overview-list">
              {upcoming.map((o) => {
                const { mon, day } = eventDateParts(o.date);
                return (
                  <ListRow
                    key={o.id}
                    as="li"
                    leading={<ListRowDate variant="accent" month={mon} day={day} />}
                    title={o.name}
                    subtitle={o.time || undefined}
                    meta={slotsLabel(o)}
                  />
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
