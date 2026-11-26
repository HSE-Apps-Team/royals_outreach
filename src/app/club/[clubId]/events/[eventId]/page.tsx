import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import EventAttendanceUI from "./ui";
import { getClubConfigById } from "@/actions/club";
import { getClubEvent } from "@/actions/events";
import { schoolToday } from "@/lib/schoolDate";

export default function EventAttendancePage({ params }: PageProps<"/club/[clubId]/events/[eventId]">) {
  return (
    <Suspense fallback={null}>
      <EventAttendanceLoader params={params} />
    </Suspense>
  );
}

async function EventAttendanceLoader({ params }: { params: Promise<{ clubId: string; eventId: string }> }) {
  await connection();
  const { clubId: clubParam, eventId: eventParam } = await params;
  const clubId = Number(clubParam);
  const eventId = Number(eventParam);
  if (!Number.isInteger(clubId) || !Number.isInteger(eventId)) notFound();

  const [club, event] = await Promise.all([getClubConfigById(clubId), getClubEvent(clubId, eventId)]);
  if (!club || !event) notFound();

  return <EventAttendanceUI clubId={clubId} clubName={club.clubName} event={event} today={schoolToday()} />;
}
