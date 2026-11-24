import { Suspense } from "react";
import { connection } from "next/server";
import StudentHomeUI from "./ui";
import { getCurrentStudent } from "@/actions/student";
import { getGoalProgress, getMyRequests } from "@/actions/hours";
import { getMyUpcomingSignUps } from "@/actions/opportunities";

export default function StudentHomePage() {
  return (
    <Suspense fallback={null}>
      <StudentHomeLoader />
    </Suspense>
  );
}

async function StudentHomeLoader() {
  // TODO: reading the session makes this request-time once auth is added
  await connection();
  const [student, clubs, requests, signUps] = await Promise.all([
    getCurrentStudent(),
    getGoalProgress(),
    getMyRequests(),
    getMyUpcomingSignUps(),
  ]);

  return <StudentHomeUI student={student} clubs={clubs} requests={requests} signUps={signUps} />;
}
