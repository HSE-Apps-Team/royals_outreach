import { Suspense } from "react";
import { connection } from "next/server";
import StaffNavUI from "./nav";
import { getCurrentStaff } from "@/actions/staff";
import "../css/shell.css";

export default function StaffLayout({ children }: LayoutProps<"/staff">) {
  return (
    <div className="shell">
      {/* Nav shows the signed-in staff member, so it streams in at request time */}
      <Suspense fallback={null}>
        <StaffNavLoader />
      </Suspense>

      <main className="shell-main">
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

async function StaffNavLoader() {
  // TODO: reading the session makes this request-time once auth is added
  await connection();
  const staff = await getCurrentStaff();

  return <StaffNavUI user={staff ? { fName: staff.fName, lName: staff.lName, role: "Staff" } : null} />;
}
