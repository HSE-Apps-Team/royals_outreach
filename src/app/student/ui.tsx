"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BannerHeader from "@/app/components/bannerHeader";
import SaveButton from "@/app/components/saveButton";
import SectionHead from "@/app/components/sectionHead";
import ProgressRing from "@/app/components/progressRing";
import ProgressBar from "@/app/components/progressBar";
import HoursStatRow from "@/app/components/hoursStatRow";
import ClubCard from "@/app/components/clubCard";
import OpportunityCard from "@/app/components/opportunityCard";
import MyEventRow from "@/app/components/myEventRow";
import RecentRequests from "@/app/components/recentRequests";
import EmptyState from "@/app/components/emptyState";
import ConfirmDialog from "@/app/components/ConfirmDialog";
import "@/app/css/student.css";
import { useToast } from "@/app/context/ToastContext";
import { formatHours } from "@/lib/formatHours";
import { fullName } from "@/lib/personName";

import type { CurrentStudent } from "@/actions/student";
import type { ClubGoalProgress, MyRequest } from "@/actions/hours";
import { cancelMySignUp, type MySignUp } from "@/actions/opportunities";
import type { MyEvent } from "@/actions/events";

type StudentHomeUIProps = {
  student: CurrentStudent | null;
  clubs: ClubGoalProgress[];
  /** Newest first. */
  requests: MyRequest[];
  /** Upcoming registrations, soonest first. */
  signUps: MySignUp[];
  /** Required club events, soonest first. */
  events: MyEvent[];
  /** The school's date, ISO ("2026-11-25"). */
  today: string;
};

// TODO: show each club's logo once logos are uploaded; clubs have no icon of their own
const CLUB_ICON = "people";

const RECENT_COUNT = 3;
const EVENT_COUNT = 3;

// Sums of tenth and quarter hours drift in floating point (0.1 + 0.2)
const sumHours = (hours: number[]) => Math.round(hours.reduce((total, h) => total + h, 0) * 100) / 100;

const formatNumber = (hours: number) => hours.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function StudentHomeUI({ student, clubs, requests, signUps, events, today }: StudentHomeUIProps) {
  const router = useRouter();
  const { showToast } = useToast();

  const [cancelling, setCancelling] = useState<MySignUp | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Clubs where an exec needs no hours do not count toward the ring
  const counted = clubs.filter((c) => !c.noHoursNeeded && c.goal > 0);
  const earned = sumHours(counted.map((c) => c.earned));
  const goal = sumHours(counted.map((c) => c.goal));

  const deniedIn = (clubId: number) =>
    sumHours(requests.filter((r) => r.clubId === clubId && r.status === "Denied").map((r) => r.hours));
  const approvedIn = (club: ClubGoalProgress) => sumHours(club.categories.map((c) => c.value));

  const approved = sumHours(clubs.map(approvedIn));
  const pending = sumHours(clubs.map((c) => c.pending));
  const denied = sumHours(clubs.map((c) => deniedIn(c.clubId)));

  const execClubs = clubs.filter((c) => c.isExec);
  const nextEvents = events.filter((e) => e.date >= today).slice(0, EVENT_COUNT);

  const handleCancel = async (signUp: MySignUp) => {
    if (isCancelling) return;

    setIsCancelling(true);
    try {
      const result = await cancelMySignUp(Number(signUp.id));
      if (result.success) showToast("Sign up cancelled.", "success");
      else showToast(result.error, "danger");
      setCancelling(null);
    } catch {
      showToast("Could not cancel this sign up. Please try again.", "danger");
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div className="student-home">
      {/* Banner */}
      <BannerHeader
        eyebrow={student?.gradClass ? `Class Of ${student.gradClass}` : null}
        title={student ? `Welcome, ${fullName(student)}!` : "Welcome!"}
      >
        <SaveButton variant="danger" icon="plus-circle" href="/student/log">
          Log Hours
        </SaveButton>
      </BannerHeader>

      {clubs.length === 0 ? (
        <EmptyState
          icon="people"
          title="You Are Not In Any Clubs Yet"
          message="Your club sponsor adds you to their club, then your goals show up here."
        />
      ) : (
        /* Progress */
        <div className={counted.length > 0 ? "student-home-progress" : undefined}>
          {counted.length > 0 && (
            <div className="student-home-ring">
              <div className="student-home-ring-label">Total Progress</div>
              <ProgressRing
                value={earned}
                goal={goal}
                label={formatNumber(earned)}
                sublabel={`of ${formatHours(goal)}`}
                met={earned >= goal}
              />
            </div>
          )}

          <div className="student-home-progress-body">
            <HoursStatRow approved={approved} pending={pending} denied={denied} />
            {counted.length > 0 && (
              <div className="student-home-bars">
                {counted.map((club) => (
                  <ProgressBar
                    key={club.clubId}
                    label={club.clubName}
                    value={club.earned}
                    goal={club.goal}
                    pending={club.pending}
                    showMet
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Required Club Events */}
      <section>
        <SectionHead
          action={
            <SaveButton size="sm" icon="calendar-check" href="/student/events">
              My Events
            </SaveButton>
          }
        >
          Required Club Events
        </SectionHead>
        <p className="student-home-events-note">
          Your clubs require you to come to these. Bring your student ID so an exec can scan you in at the door.
        </p>
        {nextEvents.length === 0 ? (
          <EmptyState size="sm" message="You have no required club events coming up." />
        ) : (
          <div>
            {nextEvents.map((e) => (
              <MyEventRow key={e.eventId} event={e} today={today} />
            ))}
          </div>
        )}
      </section>

      {/* Upcoming Registered Events */}
      <section>
        <SectionHead
          action={
            <SaveButton size="sm" icon="calendar-plus" href="/student/opportunities">
              Sign Up For Opportunities
            </SaveButton>
          }
        >
          Upcoming Registered Events
        </SectionHead>
        {signUps.length === 0 ? (
          <EmptyState size="sm" message="You are not signed up for any upcoming events." />
        ) : (
          <div>
            {signUps.map((s) => (
              <OpportunityCard key={s.id} opportunity={s} variant="mine" onCancel={() => setCancelling(s)} />
            ))}
          </div>
        )}
      </section>

      {/* Exec Clubs */}
      {execClubs.length > 0 && (
        <section>
          <SectionHead>Exec Clubs</SectionHead>
          <div className="student-home-exec">
            {execClubs.map((club) => (
              <ClubCard
                key={club.clubId}
                name={club.clubName}
                icon={CLUB_ICON}
                actions={
                  <SaveButton size="sm" icon="box-arrow-up-right" href={`/club/${club.clubId}`}>
                    Club Executive Panel
                  </SaveButton>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* My Clubs */}
      {clubs.length > 0 && (
        <section>
          <SectionHead>My Clubs</SectionHead>
          <div className="student-home-clubs">
            {clubs.map((club) => (
              <ClubCard
                key={club.clubId}
                name={club.clubName}
                icon={CLUB_ICON}
                meta={club.noHoursNeeded ? "Exec, No Hours Needed" : undefined}
              >
                <span className="student-home-club-note">{clubNote(approvedIn(club), club.pending, deniedIn(club.clubId))}</span>
              </ClubCard>
            ))}
          </div>
        </section>
      )}

      {/* Recent Requests */}
      <RecentRequests
        requests={requests.slice(0, RECENT_COUNT)}
        onViewAll={() => router.push("/student/requests")}
      />

      {/* Dialogs */}
      {cancelling && (
        <ConfirmDialog
          title="Cancel Sign Up"
          message={`Give up your spot at ${cancelling.name} on ${cancelling.fullDate}?`}
          confirmLabel={isCancelling ? "Cancelling..." : "Cancel Sign Up"}
          cancelLabel="Keep My Spot"
          onConfirm={() => handleCancel(cancelling)}
          onClose={() => !isCancelling && setCancelling(null)}
        />
      )}
    </div>
  );
}

// "3 hrs approved · 2 hrs pending · 1 hr denied", leaving out pending and denied at zero
function clubNote(approved: number, pending: number, denied: number) {
  return [
    `${formatHours(approved)} approved`,
    pending > 0 && `${formatHours(pending)} pending`,
    denied > 0 && `${formatHours(denied)} denied`,
  ]
    .filter(Boolean)
    .join(" · ");
}
