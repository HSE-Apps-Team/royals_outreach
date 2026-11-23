import { sendCoordinatorEmails } from "@/lib/coordinatorEmails";

// Runs the coordinator emails at 9am Indiana time each day. Who gets an email that morning
// (the day after a new request, then weekly reminders) is decided in src/lib/coordinatorEmails.ts.
//
// Vercel Cron schedules are in UTC and Indiana observes daylight saving time, so vercel.json
// calls this at both 13:00 UTC (9am EDT) and 14:00 UTC (9am EST) every day. Each scheduled
// call only sends when it is the 9 o'clock hour in Indiana, so one of the two sends per day.
// (On the Hobby plan a run can start anywhere within its hour, which still lands in 9–10am.)
//
// Vercel sends "Authorization: Bearer <CRON_SECRET>" and an x-vercel-cron-schedule header.
// A manual call with the secret (no schedule header) sends right away.
// Add ?dryRun=1 to see who would be emailed without sending anything.

const TIME_ZONE = "America/Indiana/Indianapolis";
const SEND_HOUR = 9;

const indianaHour = (now: Date) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(now));

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized = secret
    ? request.headers.get("authorization") === `Bearer ${secret}`
    : process.env.NODE_ENV !== "production";
  if (!authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const scheduled = request.headers.has("x-vercel-cron-schedule");
  const hour = indianaHour(new Date());
  if (scheduled && hour !== SEND_HOUR) {
    return Response.json({ skipped: `It is ${hour}:00 in Indiana; emails go out at ${SEND_HOUR}:00.` });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const coordinators = await sendCoordinatorEmails({ dryRun });

  return Response.json({ coordinators }, { status: coordinators.errors.length > 0 ? 500 : 200 });
}
