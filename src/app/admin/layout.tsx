import { Suspense } from "react";
import { connection } from "next/server";
import AdminNavUI from "./nav";
import { getCurrentAdmin } from "@/actions/admin";
import "../css/shell.css";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="shell">
      {/* Nav shows the signed-in admin, so it streams in at request time */}
      <Suspense fallback={null}>
        <AdminNavLoader />
      </Suspense>

      <main className="shell-main">
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

async function AdminNavLoader() {
  // TODO: reading the session makes this request-time once auth is added
  await connection();
  const admin = await getCurrentAdmin();

  return <AdminNavUI user={admin ? { fName: admin.fName, lName: admin.lName, role: "Admin" } : null} />;
}
