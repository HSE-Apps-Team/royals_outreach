"use client";

import PageTitle from "./pageTitle";
import ClubDirectory, { type DirectoryStaff } from "./ClubDirectory";
import "../css/staff.css";
import { useToast } from "../context/ToastContext";
import {
  addStaffToClub,
  createClub,
  deleteClub,
  removeStaffFromClub,
  type DirectoryClubRow,
  type StaffMember,
} from "@/actions/clubDirectory";

// TODO: show each club's logo once logos are uploaded; clubs have no icon of their own
const CLUB_ICON = "people";

type AllClubsViewProps = {
  clubs: DirectoryClubRow[];
  staff: StaffMember[];
  /** Admin: adds Club Executive Panel and Delete Club to every card. Staff can do everything else. */
  admin?: boolean;
};

const toDirectoryStaff = (s: StaffMember): DirectoryStaff => ({ id: s.staffId, fName: s.fName, lName: s.lName });

/** The All Clubs page body for staff and admins, wired to the club directory actions. */
export default function AllClubsView({ clubs, staff, admin = false }: AllClubsViewProps) {
  const { showToast } = useToast();

  // The actions refresh the page, so the cards and the open dialog get the new data from props
  const run = async (action: () => Promise<{ success: boolean }>, failMessage: string, doneMessage?: string) => {
    try {
      const result = await action();
      if (!result.success) throw new Error("Action failed");
      if (doneMessage) showToast(doneMessage, "success");
    } catch {
      showToast(failMessage, "danger");
    }
  };

  return (
    <div className="all-clubs">
      <PageTitle
        align="left"
        subtitle={admin ? "Create, assign staff to and delete clubs." : "Create clubs and assign staff to them."}
        style={{ margin: 0 }}
      >
        All Clubs
      </PageTitle>

      <ClubDirectory
        clubs={clubs.map((c) => ({
          id: c.clubId,
          name: c.clubName,
          icon: CLUB_ICON,
          members: c.members,
          categories: c.categories,
          staff: c.staff.map(toDirectoryStaff),
        }))}
        allStaff={staff.map(toDirectoryStaff)}
        onCreateClub={async ({ name, staffId }) => {
          try {
            const result = await createClub(name, staffId);
            if (!result.success) return result.error;
            showToast(`${name} created.`, "success");
          } catch {
            return "Could not create the club. Please try again.";
          }
        }}
        onAddStaff={(clubId, staffId) =>
          run(() => addStaffToClub(clubId, staffId), "Could not assign that staff member.")
        }
        onRemoveStaff={(clubId, staffId) =>
          run(() => removeStaffFromClub(clubId, staffId), "Could not remove that staff member.")
        }
        panelHref={admin ? (clubId) => `/club/${clubId}` : undefined}
        onDeleteClub={
          admin
            ? (clubId) => {
                const name = clubs.find((c) => c.clubId === clubId)?.clubName ?? "Club";
                run(() => deleteClub(clubId), "Could not delete the club.", `${name} deleted.`);
              }
            : undefined
        }
      />
    </div>
  );
}
