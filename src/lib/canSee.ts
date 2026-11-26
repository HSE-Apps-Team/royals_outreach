// Role-based visibility for the Club Executive Panel side nav and sections.
// Staff (assigned sponsor) and Admin see every section. A Student (club exec)
// only sees the sections a staff sponsor has opened to execs.

export type ClubRole = "Staff" | "Student" | "Admin";

export type ClubSection =
  | "overview"
  | "config"
  | "members"
  | "categories"
  | "groups"
  | "requests"
  | "progress"
  | "lookup"
  | "events"
  | "opportunities"
  | "export"
  | "images"
  | "roles";

const STUDENT_SECTIONS: ClubSection[] = [
  "overview",
  "requests",
  "progress",
  "events",
  "opportunities",
  "images",
];

export function canSee(section: ClubSection, role: ClubRole): boolean {
  if (role === "Staff" || role === "Admin") return true;
  return STUDENT_SECTIONS.includes(section);
}

// TODO: comes from the session once RBAC is added
export const CURRENT_CLUB_ROLE: ClubRole = "Staff";
