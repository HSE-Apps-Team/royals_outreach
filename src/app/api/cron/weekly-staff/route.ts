import { sendStaffWeeklySummaries } from "@/lib/staffSummary";

// The Monday summary for staff sponsors, sent in the 6am hour Indiana time
// (src/lib/staffSummary.ts builds and sends them).
//
// Vercel Cron schedules are in UTC and Indiana observes daylight saving time, so vercel.json
// calls this every Monday at both 10:00 UTC (6am EDT) and 11:00 UTC (6am EST). Each scheduled
// call only sends when it is Monday in the 6 o'clock hour in Indiana, so one of the two sends.
// (On the Hobby plan a run can start anywhere within its hour, which still lands in 6–7am.)
// A repeat in the same week is not sent twice: each email's idempotency key names the week.
//
// Vercel sends "Authorization: Bearer <CRON_SECRET>". A manual call with the secret (no schedule
// header) sends right away, covering the last 7 days. Add:
//   ?dryRun=1   to see who would get what without sending
//   ?now=1      to send again even if this week's summaries already went out (testing)
//   ?clubId=3   for one club only

const TIME_ZONE = "America/Indiana/Indianapolis";
const SEND_HOUR = 6;

const indianaNow = (now: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  return {
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
    hour: Number(parts.find((p) => p.type === "hour")?.value),
  };
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized = secret
    ? request.headers.get("authorization") === `Bearer ${secret}`
    : process.env.NODE_ENV !== "production";
  if (!authorized) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const scheduled = request.headers.has("x-vercel-cron-schedule");
  const { weekday, hour } = indianaNow(new Date());
  if (scheduled && (weekday !== "Mon" || hour !== SEND_HOUR)) {
    return Response.json({ skipped: `It is ${weekday} ${hour}:00 in Indiana; summaries go out Monday at ${SEND_HOUR}:00.` });
  }

  const params = new URL(request.url).searchParams;
  const clubId = Number(params.get("clubId"));
  const report = await sendStaffWeeklySummaries({
    dryRun: params.get("dryRun") === "1",
    now: params.get("now") === "1",
    clubId: Number.isInteger(clubId) && clubId > 0 ? clubId : undefined,
  });

  return Response.json(report, { status: report.errors.length > 0 ? 500 : 200 });
}
