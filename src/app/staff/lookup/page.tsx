import { Suspense } from "react";
import { connection } from "next/server";
import StudentLookupView from "@/app/components/studentLookupView";
import { getStudentIndex } from "@/actions/studentLookup";

export default function StaffLookupPage() {
  return (
    <Suspense fallback={null}>
      <StaffLookupLoader />
    </Suspense>
  );
}

async function StaffLookupLoader() {
  // TODO: reading the session makes this request-time once auth is added
  await connection();
  const students = await getStudentIndex();

  return <StudentLookupView students={students} />;
}
