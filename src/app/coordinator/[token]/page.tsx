import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import CoordinatorUI from "./ui";
import CoordinatorFrame, { CoordinatorNotice } from "../coordinatorFrame";
import { getCoordinatorPage } from "@/actions/coordinator";

export const metadata: Metadata = {
  title: "Confirm Volunteer Hours · Royals Outreach",
  robots: { index: false, follow: false },
};

export default function CoordinatorPage({ params }: PageProps<"/coordinator/[token]">) {
  return (
    <Suspense fallback={null}>
      <CoordinatorLoader params={params} />
    </Suspense>
  );
}

async function CoordinatorLoader({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const data = await getCoordinatorPage(token);

  if (!data) {
    return (
      <CoordinatorFrame>
        <CoordinatorNotice title="This Link Is Not Valid">
          Open the newest email from Royals Outreach and use the link in it.
        </CoordinatorNotice>
      </CoordinatorFrame>
    );
  }

  return <CoordinatorUI token={token} data={data} />;
}
