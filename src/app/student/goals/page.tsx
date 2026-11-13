import { Suspense } from "react";
import { connection } from "next/server";
import GoalProgressUI from "./ui";
import { getGoalProgress } from "@/actions/hours";

export default function GoalProgressPage() {
  return (
    <Suspense fallback={null}>
      <GoalProgressLoader />
    </Suspense>
  );
}

async function GoalProgressLoader() {
  // TODO: reading the session makes this request-time once auth is added
  await connection();
  const clubs = await getGoalProgress();

  return <GoalProgressUI clubs={clubs} />;
}
