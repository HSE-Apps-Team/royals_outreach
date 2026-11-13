import { Suspense } from "react";
import { connection } from "next/server";
import BannerHeader from "@/app/components/bannerHeader";
import ClubPanelTiles from "@/app/components/clubPanelTiles";
import "@/app/css/staff.css";
import { getCurrentStaff, getMyStaffClubs } from "@/actions/staff";
import { fullName } from "@/lib/personName";

// TODO: show each club's logo once logos are uploaded; clubs have no icon of their own
const CLUB_ICON = "people";

export default function StaffHomePage() {
  return (
    <Suspense fallback={null}>
      <StaffHomeLoader />
    </Suspense>
  );
}

async function StaffHomeLoader() {
  // TODO: reading the session makes this request-time once auth is added
  await connection();
  const [staff, clubs] = await Promise.all([getCurrentStaff(), getMyStaffClubs()]);

  return (
    <div className="staff-home">
      <BannerHeader eyebrow="Staff" title={staff ? `Welcome, ${fullName(staff)}!` : "Welcome!"} />
      <ClubPanelTiles
        clubs={clubs.map((c) => ({
          name: c.clubName,
          icon: CLUB_ICON,
          total: c.totalHours,
          href: `/club/${c.clubId}`,
        }))}
      />
    </div>
  );
}
