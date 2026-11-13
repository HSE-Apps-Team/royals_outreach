import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import ClubLookupUI from "./ui";
import { getClubLookup } from "@/actions/clubLookup";

export default function ClubLookupPage({ params }: PageProps<"/club/[clubId]/lookup">) {
  return (
    <Suspense fallback={null}>
      <ClubLookupLoader params={params} />
    </Suspense>
  );
}

async function ClubLookupLoader({ params }: { params: Promise<{ clubId: string }> }) {
  await connection();
  const clubId = Number((await params).clubId);
  if (!Number.isInteger(clubId)) notFound();

  const lookup = await getClubLookup(clubId);
  if (!lookup) notFound();

  return <ClubLookupUI lookup={lookup} />;
}
