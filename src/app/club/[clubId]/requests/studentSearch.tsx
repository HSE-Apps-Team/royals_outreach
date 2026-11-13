"use client";

import { useState } from "react";
import Input from "@/app/components/input";
import ListRow from "@/app/components/listRow";
import SaveButton from "@/app/components/saveButton";
import "@/app/css/club.css";
import { fullName } from "@/lib/personName";

import type { ClubMember } from "@/actions/members";

type StudentSearchProps = {
  members: ClubMember[];
  /** Selected student ID, or "" for none. */
  value: string;
  onChange: (studentId: string) => void;
  error?: string;
};

const MAX_RESULTS = 6;

const memberLine = (m: ClubMember) =>
  [String(m.studentId), m.groupName, m.gradClass ? `Class Of ${m.gradClass}` : null].filter(Boolean).join(" · ");

// Search by name or student ID, then pick from the matches.
export default function StudentSearch({ members, value, onChange, error }: StudentSearchProps) {
  const [query, setQuery] = useState("");

  const selected = members.find((m) => String(m.studentId) === value);
  if (selected) {
    return (
      <div className="student-search">
        <span className="input-field-label">Student</span>
        <div className="student-search-selected">
          <ListRow
            title={fullName(selected)}
            subtitle={memberLine(selected)}
            subtitleTone="muted"
            divider="none"
            trailing={
              <SaveButton size="sm" variant="secondary" onClick={() => onChange("")}>
                Change
              </SaveButton>
            }
          />
        </div>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = q
    ? members
        .filter((m) => `${fullName(m)} ${m.studentId}`.toLowerCase().includes(q))
        .sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { sensitivity: "base" }))
    : [];

  return (
    <div className="student-search">
      <Input
        label="Student"
        icon="search"
        placeholder="Search by name or student ID"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        error={error}
      />
      {q && (
        <div className="student-search-results">
          {matches.length === 0 ? (
            <p className="club-muted-line student-search-empty">No active members match.</p>
          ) : (
            <>
              {matches.slice(0, MAX_RESULTS).map((m) => (
                <ListRow
                  key={m.studentId}
                  title={fullName(m)}
                  subtitle={memberLine(m)}
                  subtitleTone="muted"
                  density="compact"
                  onClick={() => onChange(String(m.studentId))}
                />
              ))}
              {matches.length > MAX_RESULTS && (
                <p className="club-muted-line student-search-empty">
                  Showing {MAX_RESULTS} of {matches.length}. Keep typing to narrow it down.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
