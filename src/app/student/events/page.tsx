import { Suspense } from "react";
import { connection } from "next/server";
import MyEventsUI from "./ui";
import { getMyEvents } from "@/actions/events";
import { schoolToday } from "@/lib/schoolDate";

export default function MyEventsPage() {
  return (
    <Suspense fallback={null}>
      <MyEventsLoader />
    </Suspense>
  );
}

async function MyEventsLoader() {
  // TODO: reading the session makes this request-time once auth is added
  await connection();
  const events = await getMyEvents();

  return <MyEventsUI events={events} today={schoolToday()} />;
}
