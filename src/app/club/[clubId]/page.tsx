import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import ClubOverviewUI from "./ui";
import { getClubOverview } from "@/actions/clubOverview";
import { CURRENT_CLUB_ROLE } from "@/lib/canSee";

export default function ClubOverviewPage({ params }: PageProps<"/club/[clubId]">) {
  return (
    <Suspense fallback={null}>
      <ClubOverviewLoader params={params} />
    </Suspense>
  );
}

async function ClubOverviewLoader({ params }: { params: Promise<{ clubId: string }> }) {
  // Waiting requests and upcoming opportunities change by the minute, so this renders at request time
  await connection();
  const clubId = Number((await params).clubId);
  if (!Number.isInteger(clubId)) notFound();

  const overview = await getClubOverview(clubId);
  if (!overview) notFound();

  return <ClubOverviewUI clubId={clubId} overview={overview} role={CURRENT_CLUB_ROLE} />;
}
