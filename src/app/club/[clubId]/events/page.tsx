import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import EventsUI from "./ui";
import { getClubConfigById } from "@/actions/club";
import { getClubEvents, getEventGroupOptions } from "@/actions/events";
import { schoolToday } from "@/lib/schoolDate";

export default function EventsPage({ params, searchParams }: PageProps<"/club/[clubId]/events">) {
  return (
    <Suspense fallback={null}>
      <EventsLoader params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EventsLoader({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const clubId = Number((await params).clubId);
  if (!Number.isInteger(clubId)) notFound();

  // ?edit=12 opens that event's Edit Event dialog (the attendance page's Edit Event button)
  const edit = (await searchParams).edit;
  const editId = Number(Array.isArray(edit) ? edit[0] : edit);

  const [club, events, groups] = await Promise.all([
    getClubConfigById(clubId),
    getClubEvents(clubId),
    getEventGroupOptions(clubId),
  ]);
  if (!club) notFound();

  return (
    <EventsUI
      clubId={clubId}
      clubName={club.clubName}
      events={events}
      groups={groups}
      today={schoolToday()}
      initialEditId={Number.isInteger(editId) && editId > 0 ? editId : null}
    />
  );
}
