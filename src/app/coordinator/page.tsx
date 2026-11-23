import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import CoordinatorFrame, { CoordinatorNotice } from "./coordinatorFrame";
import { getCoordinatorsWaiting } from "@/actions/coordinator";
import { coordinatorToken } from "@/lib/coordinatorLink";
import { plural } from "@/lib/plural";

export const metadata: Metadata = {
  title: "Confirm Volunteer Hours · Royals Outreach",
  robots: { index: false, follow: false },
};

// Coordinators always arrive with a link. Until emails are sent, development lists a link for
// every coordinator with requests waiting so the page can be tried.
export default function CoordinatorIndexPage() {
  return (
    <CoordinatorFrame>
      <CoordinatorNotice title="Open The Link From Your Email">
        Each coordinator gets their own link by email to confirm volunteer hours.
      </CoordinatorNotice>
      <Suspense fallback={null}>
        <DevLinks />
      </Suspense>
    </CoordinatorFrame>
  );
}

async function DevLinks() {
  if (process.env.NODE_ENV === "production") return null;
  await connection();
  const coordinators = await getCoordinatorsWaiting();
  if (coordinators.length === 0) return null;

  return (
    <div className="coordinator-notice">
      <ul className="coordinator-dev-links" aria-label="Development coordinator links">
        {coordinators.map((c) => (
          <li key={c.email}>
            <Link href={`/coordinator/${coordinatorToken(c.email)}`}>{c.email}</Link>
            <span>{plural(c.waiting, "request")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
