import { Suspense } from "react";
import { connection } from "next/server";
import ClubPanelNavUI from "./nav";
import { getClubPendingRequestCount } from "@/actions/clubRequests";
import { getClubEventsTodayCount } from "@/actions/events";
import "../../css/shell.css";

export default function ClubPanelLayout({ children, params }: LayoutProps<"/club/[clubId]">) {
  return (
    <div className="shell">
      {/* Nav reads the club id from the URL, so it streams in at request time */}
      <Suspense fallback={null}>
        <ClubPanelNavLoader params={params} />
      </Suspense>

      <main className="shell-main">
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

async function ClubPanelNavLoader({ params }: { params: Promise<{ clubId: string }> }) {
  // The Events badge counts today's events, so the nav renders at request time
  await connection();
  const clubId = Number((await params).clubId);
  const [pendingRequests, eventsToday] = Number.isInteger(clubId)
    ? await Promise.all([getClubPendingRequestCount(clubId), getClubEventsTodayCount(clubId)])
    : [0, 0];

  return <ClubPanelNavUI pendingRequests={pendingRequests} eventsToday={eventsToday} />;
}
