"use client";

import React, { useState } from "react";
import FilterBar from "./filterBar";
import SaveButton from "./saveButton";
import SectionHead from "./sectionHead";
import ClubCard from "./clubCard";
import Badge from "./badge";
import EmptyState from "./emptyState";
import CreateClubDialog from "./CreateClubDialog";
import AssignStaffDialog from "./AssignStaffDialog";
import ConfirmDialog from "./ConfirmDialog";
import "../css/staff.css";
import { plural } from "@/lib/plural";
import { fullName, type PersonName } from "@/lib/personName";

/** A staff member; `id` is passed back in the callbacks. */
export type DirectoryStaff = PersonName & { id: number };

export type DirectoryClub = {
  id: number;
  name: string;
  /** Bootstrap Icons name without the `bi-` prefix. */
  icon: string;
  members: number;
  /** Number of categories; 0 shows "General Hours Only". */
  categories: number;
  staff: DirectoryStaff[];
};

type ClubDirectoryProps = {
  clubs?: DirectoryClub[];
  /** Every staff member, offered in the Create Club and Assign Staff dialogs. */
  allStaff?: DirectoryStaff[];
  /** Return an error message to keep the dialog open and show it under Club Name. */
  onCreateClub?: (values: { name: string; staffId: number | null }) => CreateResult | Promise<CreateResult>;
  onAddStaff?: (clubId: number, staffId: number) => void;
  onRemoveStaff?: (clubId: number, staffId: number) => void;
  /** Admin only: shows a Delete Club button on each card and the confirm dialog. */
  onDeleteClub?: (clubId: number) => void;
  /** Admin only: shows a Club Executive Panel button first on each card. */
  onOpenPanel?: (clubId: number) => void;
  /** Builds a link for the panel button when no onOpenPanel is given. */
  panelHref?: (clubId: number) => string;
  query?: string;
  onQueryChange?: (query: string) => void;
  className?: string;
};

type CreateResult = string | null | void;

const IROH = { id: 1, fName: "Iroh", lName: "Bennett" };
const TOM = { id: 2, fName: "Tom", lName: "Brooks" };
const DAVID = { id: 3, fName: "David", lName: "Chen" };
const LINH = { id: 4, fName: "Linh", lName: "Nguyen" };
const CHIDI = { id: 5, fName: "Chidi", lName: "Okafor" };
const PRIYA = { id: 6, fName: "Priya", lName: "Patel" };

const DEFAULT_CLUBS: DirectoryClub[] = [
  { id: 1, name: "Key Club", icon: "heart", members: 64, categories: 2, staff: [TOM, PRIYA] },
  { id: 2, name: "Art Club", icon: "palette", members: 41, categories: 2, staff: [DAVID] },
  { id: 3, name: "Robotics Club", icon: "gear", members: 28, categories: 0, staff: [CHIDI] },
  { id: 4, name: "National Honor Society", icon: "award", members: 120, categories: 3, staff: [IROH, LINH] },
  { id: 5, name: "Spanish Honor Society", icon: "translate", members: 52, categories: 1, staff: [LINH] },
  { id: 6, name: "Student Council", icon: "megaphone", members: 86, categories: 2, staff: [IROH] },
  { id: 7, name: "Chess Club", icon: "puzzle", members: 19, categories: 0, staff: [] },
];

const DEFAULT_STAFF: DirectoryStaff[] = [IROH, TOM, DAVID, LINH, CHIDI, PRIYA];

// The dialogs pass back the same staff objects they were given, so the id is still on them
const idOf = (staff: PersonName) => (staff as DirectoryStaff).id;

export default function ClubDirectory({
  clubs = DEFAULT_CLUBS,
  allStaff = DEFAULT_STAFF,
  onCreateClub,
  onAddStaff,
  onRemoveStaff,
  onDeleteClub,
  onOpenPanel,
  panelHref,
  query,
  onQueryChange,
  className = "",
}: ClubDirectoryProps) {
  const [innerQuery, setInnerQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<DirectoryClub | null>(null);

  const q = query ?? innerQuery;
  const shown = clubs.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  const assignClub = clubs.find((c) => c.id === assigning);

  return (
    <div className={`staff-directory ${className}`.trim()}>
      {/* Search and create */}
      <FilterBar
        searchPlaceholder="Search Clubs"
        searchValue={q}
        onSearchChange={(value) => {
          setInnerQuery(value);
          onQueryChange?.(value);
        }}
        actions={
          <SaveButton variant="danger" icon="plus-circle" onClick={() => setCreating(true)}>
            Create Club
          </SaveButton>
        }
      />

      {/* Count */}
      <SectionHead className="staff-directory-count">
        {plural(clubs.length, "Club")}
        {q.trim() ? ` · ${shown.length} Shown` : ""}
      </SectionHead>

      {/* Cards */}
      {shown.length > 0 ? (
        <div className="club-card-grid">
          {shown.map((c) => (
            <ClubCard
              key={c.id}
              name={c.name}
              icon={c.icon}
              meta={`${plural(c.members, "Member")} · ${
                c.categories ? plural(c.categories, "Category", "Categories") : "General Hours Only"
              }`}
              actions={
                <>
                  {(onOpenPanel || panelHref) && (
                    <SaveButton
                      size="sm"
                      icon="box-arrow-up-right"
                      onClick={onOpenPanel ? () => onOpenPanel(c.id) : undefined}
                      href={panelHref?.(c.id)}
                    >
                      Club Executive Panel
                    </SaveButton>
                  )}
                  <SaveButton
                    size="sm"
                    variant="secondary"
                    icon="person-plus"
                    onClick={() => setAssigning(c.id)}
                  >
                    Assign Staff
                  </SaveButton>
                  {onDeleteClub && (
                    <SaveButton size="sm" variant="danger" icon="trash" onClick={() => setDeleting(c)}>
                      Delete Club
                    </SaveButton>
                  )}
                </>
              }
            >
              <span className="staff-card-label">Staff</span>
              {c.staff.length > 0 ? (
                <div className="staff-card-staff">{c.staff.map(fullName).join(", ")}</div>
              ) : (
                <div>
                  <Badge tone="denied">No Staff Assigned</Badge>
                </div>
              )}
            </ClubCard>
          ))}
        </div>
      ) : (
        <EmptyState message="No clubs match your search." />
      )}

      {/* Dialogs */}
      {creating && (
        <CreateClubDialog
          staffOptions={allStaff}
          onClose={() => setCreating(false)}
          onCreate={async ({ name, staff }) => {
            const error = await onCreateClub?.({ name, staffId: staff ? idOf(staff) : null });
            if (!error) setCreating(false);
            return error;
          }}
        />
      )}
      {assignClub && (
        <AssignStaffDialog
          clubName={assignClub.name}
          assigned={assignClub.staff}
          allStaff={allStaff}
          onAdd={(staff) => onAddStaff?.(assignClub.id, idOf(staff))}
          onRemove={(staff) => onRemoveStaff?.(assignClub.id, idOf(staff))}
          onClose={() => setAssigning(null)}
        />
      )}
      {deleting && onDeleteClub && (
        <ConfirmDialog
          message={`Delete ${deleting.name}? Its categories, member groups and opportunities will be removed, and its pending hour requests will be denied. Logged hours stay on student records.`}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            onDeleteClub(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}
