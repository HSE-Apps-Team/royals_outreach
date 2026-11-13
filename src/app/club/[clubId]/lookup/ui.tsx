"use client";

import ClubSectionHeader from "@/app/components/clubSectionHeader";
import StudentLookup, { type LookupStudent } from "@/app/components/studentLookup";
import "@/app/css/club.css";
import type { ClubLookup } from "@/actions/clubLookup";

type ClubLookupUIProps = {
  lookup: ClubLookup;
};

export default function ClubLookupUI({ lookup }: ClubLookupUIProps) {
  const { clubName, students } = lookup;

  // StudentLookup scopes to one club by name, so each student carries just this club
  const lookupStudents: LookupStudent[] = students.map((s) => ({
    id: String(s.studentId),
    fName: s.fName,
    lName: s.lName,
    email: s.email,
    gradYear: s.gradClass,
    studentId: String(s.studentId),
    clubs: [
      {
        name: clubName,
        goal: s.categories.reduce((total, c) => total + c.goal, 0),
        group: s.groupName ?? undefined,
        categories: s.categories.map((c) => ({ name: c.name, goal: c.goal, value: c.value })),
        added: s.added,
        inactive: !s.isActive,
      },
    ],
    logs: s.logs,
  }));

  return (
    <div className="club-lookup">
      <ClubSectionHeader
        title="Look Up Students"
        subtitle="Search by name, email or student ID. Hours shown are for this club only."
        clubName={clubName}
      />

      <StudentLookup
        students={lookupStudents}
        club={clubName}
        editable={false}
        emptyText={students.length === 0 ? "This club has no members yet." : undefined}
      />
    </div>
  );
}
