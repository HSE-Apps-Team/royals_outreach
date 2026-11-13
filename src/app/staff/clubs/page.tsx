import { Suspense } from "react";
import { connection } from "next/server";
import AllClubsView from "@/app/components/allClubsView";
import { getAllClubs, getAllStaff } from "@/actions/clubDirectory";

export default function AllClubsPage() {
  return (
    <Suspense fallback={null}>
      <AllClubsLoader />
    </Suspense>
  );
}

async function AllClubsLoader() {
  // TODO: reading the session makes this request-time once auth is added
  await connection();
  const [clubs, staff] = await Promise.all([getAllClubs(), getAllStaff()]);

  return <AllClubsView clubs={clubs} staff={staff} />;
}
