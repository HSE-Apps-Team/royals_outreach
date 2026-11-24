"use client";

import { useRef, useState } from "react";
import ClubSectionHeader from "@/app/components/clubSectionHeader";
import CategoryProgress from "@/app/components/categoryProgress";
import StatCard from "@/app/components/statCard";
import Input from "@/app/components/input";
import Select from "@/app/components/select";
import ListRow from "@/app/components/listRow";
import Badge from "@/app/components/badge";
import EmptyState from "@/app/components/emptyState";
import SaveButton from "@/app/components/saveButton";
import { useToast } from "@/app/context/ToastContext";
import "@/app/css/club.css";
import { formatHours } from "@/lib/formatHours";
import { percent } from "@/lib/percent";
import { plural } from "@/lib/plural";
import { fullName } from "@/lib/personName";

import { sendStaffSummaryNow, type ClubProgress, type StudentProgress } from "@/actions/clubProgress";

type HoursProgressUIProps = {
  clubId: number;
  progress: ClubProgress;
};

const ALL = "all";
const NO_GROUP = "none";

const classLabel = (s: StudentProgress) => (s.gradClass ? `Class Of ${s.gradClass}` : null);

// Right-hand value on a student row
const progressLabel = (s: StudentProgress) => (s.noHoursNeeded ? "Exec" : `${percent(s.earned, s.goal)}%`);

const hoursOf = (value: number, goal: number) => formatHours(value, goal).replace(" / ", " of ");

export default function HoursProgressUI({ clubId, progress }: HoursProgressUIProps) {
  const { clubName, groups, students, total } = progress;
  const { showToast } = useToast();
  const [isEmailing, setIsEmailing] = useState(false);

  // TODO: testing only, remove before launch (with sendStaffSummaryNow)
  const sendReportNow = async () => {
    setIsEmailing(true);
    const result = await sendStaffSummaryNow(clubId);
    setIsEmailing(false);
    if (!result.success) {
      showToast(result.error, "danger");
      return;
    }
    showToast(`Sent ${plural(result.sent, "advisor report")}.`);
  };

  const [search, setSearch] = useState("");
  const [group, setGroup] = useState(ALL);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detailsRef = useRef<HTMLDivElement>(null);

  const query = search.trim().toLowerCase();
  const visible = students.filter(
    (s) =>
      (group === ALL || (group === NO_GROUP ? s.groupId === null : String(s.groupId) === group)) &&
      (!query || `${fullName(s)} ${s.studentId}`.toLowerCase().includes(query)),
  );
  const selected = visible.find((s) => s.studentId === selectedId) ?? visible[0];

  const select = (studentId: number) => {
    setSelectedId(studentId);
    // The details sit under the list on narrow screens
    detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const hasGroups = groups.length > 0;
  const hasNoGroup = hasGroups && students.some((s) => s.groupId === null);
  // Group under each name, or the class when the club has no groups
  const groupLabel = (s: StudentProgress) => (hasGroups ? (s.groupName ?? "No Group") : classLabel(s));
  const average = total.students > 0 ? Math.round((total.approved / total.students) * 10) / 10 : 0;

  return (
    <div className="club-progress">
      {/* Header */}
      <ClubSectionHeader
        title="Hours Progress"
        subtitle="Track club, category and student progress toward hour goals."
        clubName={clubName}
        actions={
          // TODO: testing only, remove before launch
          <SaveButton size="sm" variant="secondary" icon="envelope" disabled={isEmailing} onClick={sendReportNow}>
            {isEmailing ? "Sending..." : "Send Advisor Report Now"}
          </SaveButton>
        }
      />

      {total.categories.length === 0 ? (
        <EmptyState icon="tags" message="This club has no categories yet. Add one to start tracking hours." />
      ) : (
        <>
          {/* Club total */}
          <CategoryProgress
            variant="total"
            ringSize={160}
            earned={total.earned}
            goal={total.goal}
            ringCaption="Club Total"
            ringLabel={`${percent(total.earned, total.goal)}%`}
            ringSublabel={hoursOf(total.earned, total.goal)}
            ringNote={`${total.metGoal} of ${total.students} Met Goal`}
            categories={total.categories.map((c) => ({
              name: c.name,
              value: c.value,
              goal: c.goal,
              pending: c.pending,
              line: `${plural(c.students, "student")} · ${percent(c.value, c.goal)}% of goal`,
            }))}
          />

          <div className="club-progress-stats">
            <StatCard tone="solid" label="Average Per Student" value={formatHours(average)} />
            <StatCard label="Pending Hours" value={formatHours(total.pending)} />
          </div>

          {/* Students */}
          <div className="club-progress-body">
            <div className="club-progress-list">
              <Input
                icon="search"
                placeholder="Search Students"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {hasGroups && (
                <Select
                  options={[
                    { value: ALL, label: "All Groups" },
                    ...groups.map((g) => ({ value: String(g.groupId), label: g.groupName })),
                    ...(hasNoGroup ? [{ value: NO_GROUP, label: "No Group" }] : []),
                  ]}
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                />
              )}

              {visible.length === 0 ? (
                <EmptyState
                  size="sm"
                  message={students.length === 0 ? "This club has no active members." : "No students match your filters."}
                />
              ) : (
                <div>
                  {visible.map((s) => (
                    <ListRow
                      key={s.studentId}
                      title={fullName(s)}
                      subtitle={groupLabel(s)}
                      subtitleTone="muted"
                      meta={progressLabel(s)}
                      selected={s.studentId === selected?.studentId}
                      onClick={() => select(s.studentId)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Details */}
            <div ref={detailsRef}>
              {selected && (
                <CategoryProgress
                  variant="detail"
                  ringSize={140}
                  earned={selected.earned}
                  goal={selected.goal}
                  ringLabel={`${percent(selected.earned, selected.goal)}%`}
                  ringSublabel={`of ${formatHours(selected.goal)}`}
                  ringNote={selected.pending > 0 ? `${formatHours(selected.pending)} pending` : undefined}
                  heading={fullName(selected)}
                  meta={[hasGroups ? groupLabel(selected) : null, classLabel(selected)]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={
                    selected.noHoursNeeded ? (
                      <Badge tone="info">Exec · No Hours Needed</Badge>
                    ) : selected.met ? (
                      <Badge tone="approved">Met Goal</Badge>
                    ) : undefined
                  }
                  categories={selected.categories}
                  noCategoriesNote="This student's group has no categories."
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
