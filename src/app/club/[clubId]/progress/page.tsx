import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import HoursProgressUI from "./ui";
import { getClubProgress } from "@/actions/clubProgress";

export default function HoursProgressPage({ params }: PageProps<"/club/[clubId]/progress">) {
  return (
    <Suspense fallback={null}>
      <HoursProgressLoader params={params} />
    </Suspense>
  );
}

async function HoursProgressLoader({ params }: { params: Promise<{ clubId: string }> }) {
  await connection();
  const clubId = Number((await params).clubId);
  if (!Number.isInteger(clubId)) notFound();

  const progress = await getClubProgress(clubId);
  if (!progress) notFound();

  return <HoursProgressUI progress={progress} />;
}
