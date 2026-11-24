import type { OutgoingEmail } from "@/lib/email";
import { BLUE, FONT, GRAY, INK, NAVY, RED, SILVER, TINT, button, escape, heading, layout } from "@/lib/emailTemplates";
import { formatDate } from "@/lib/formatDate";
import { formatHours } from "@/lib/formatHours";
import { plural } from "@/lib/plural";

// The Monday summary for a club's staff sponsors. The numbers come from src/lib/staffSummary.ts.
// Markup follows emailTemplates.ts: tables and inline styles.

const GREEN = "#1e7e34";
const GREEN_TINT = "#e8f4eb";
const AMBER = "#b7791f";
const AMBER_TINT = "#fdf4e3";
const RED_TINT = "#fdecef";

export type StaffWeeklySummary = {
  clubName: string;
  /** ISO dates of the week covered, e.g. "2026-11-16" to "2026-11-22". */
  firstDay: string;
  lastDay: string;
  week: {
    submitted: number;
    submittedHours: number;
    studentsLogging: number;
    approved: number;
    approvedHours: number;
    denied: number;
  };
  waiting: {
    /** Requests waiting for the club to review. */
    club: number;
    /** Days the oldest of them has waited, or null with none. */
    clubOldestDays: number | null;
    /** Requests waiting on a coordinator's email answer. */
    coordinator: number;
    /** Of those, logged more than a week ago. */
    coordinatorOverdue: number;
  };
  members: {
    active: number;
    /** Active members who need hours (execs who do not are left out). */
    counted: number;
    metAllGoals: number;
    noHours: number;
    hasGoals: boolean;
  };
  categories: { name: string; goal: number; members: number; met: number; averagePercent: number | null }[];
  topStudents: { name: string; hours: number }[];
  links: { requests: string; progress: string };
};

//--------------------------------------------------------------------------------------//
//                                       Helpers                                        //
//--------------------------------------------------------------------------------------//

const section = (title: string) =>
  `<h2 style="margin:26px 0 12px;padding-bottom:6px;border-bottom:2px solid ${SILVER};font:700 16px ${FONT};color:${NAVY}">${escape(title)}</h2>`;

const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

// "Nov 16 – 22, 2026", or "Nov 30 – Dec 6, 2026" across months.
const weekRange = (first: string, last: string) => {
  const [startMonth, startDay] = formatDate(first, "short").split(" ");
  const [endMonth, endDay] = formatDate(last, "short").split(" ");
  const year = last.slice(0, 4);
  return startMonth === endMonth
    ? `${startMonth} ${startDay} – ${endDay}, ${year}`
    : `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
};

// A highlighted line in Needs Attention: colored bar on the left, then the text.
const callout = (tone: "red" | "amber" | "green" | "blue", title: string, detail: string) => {
  const [bar, tint] =
    tone === "red" ? [RED, RED_TINT] : tone === "amber" ? [AMBER, AMBER_TINT] : tone === "green" ? [GREEN, GREEN_TINT] : [BLUE, TINT];
  return `
    <tr><td style="padding:12px 14px;border-left:4px solid ${bar};background:${tint};border-radius:0 6px 6px 0">
      <div style="font:700 15px/1.4 ${FONT};color:${INK}">${title}</div>
      ${detail ? `<div style="margin-top:2px;font:400 14px/1.5 ${FONT};color:${GRAY}">${detail}</div>` : ""}
    </td></tr>
    <tr><td style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>`;
};

// A number with its label underneath, two per row.
const tile = (value: string, label: string, note: string) => `
  <td width="50%" valign="top" style="padding:6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:14px 16px;border-radius:8px;background:${TINT}">
        <div style="font:700 26px/1.1 ${FONT};color:${BLUE}">${escape(value)}</div>
        <div style="margin-top:4px;font:700 13px ${FONT};color:${INK}">${escape(label)}</div>
        <div style="margin-top:2px;font:600 12px ${FONT};color:${GRAY}">${escape(note)}</div>
      </td>
    </tr></table>
  </td>`;

// A filled bar, as a two-cell table since mail apps ignore most CSS widths.
const bar = (percent: number, color: string) => {
  const filled = Math.max(0, Math.min(100, Math.round(percent)));
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:5px;overflow:hidden;background:${SILVER}"><tr>
      ${filled > 0 ? `<td width="${filled}%" style="height:10px;line-height:10px;font-size:0;background:${color}">&nbsp;</td>` : ""}
      ${filled < 100 ? `<td style="height:10px;line-height:10px;font-size:0">&nbsp;</td>` : ""}
    </tr></table>`;
};

//--------------------------------------------------------------------------------------//
//                                        Email                                         //
//--------------------------------------------------------------------------------------//

export function staffWeeklySummaryEmail({
  to,
  firstName,
  summary: s,
}: {
  to: string;
  firstName: string;
  summary: StaffWeeklySummary;
}): OutgoingEmail {
  const range = weekRange(s.firstDay, s.lastDay);
  const subject = `${s.clubName} weekly summary: ${range}`;
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  const metPercent = s.members.counted > 0 ? Math.round((s.members.metAllGoals / s.members.counted) * 100) : 0;

  // Needs Attention: what is still waiting, most urgent first
  const attention: { tone: "red" | "amber" | "green" | "blue"; title: string; detail: string; text: string }[] = [];
  if (s.waiting.club > 0) {
    const old = s.waiting.clubOldestDays ?? 0;
    const waited = old > 0 ? `The oldest has waited ${plural(old, "day")}.` : "They came in today.";
    attention.push({
      tone: old >= 7 ? "red" : "amber",
      title: `${plural(s.waiting.club, "hour request")} waiting for the club to review`,
      detail: `${waited} Approve or deny them on Hour Requests.`,
      text: `${plural(s.waiting.club, "hour request")} waiting for the club to review. ${waited}`,
    });
  }
  if (s.waiting.coordinator > 0) {
    const overdue =
      s.waiting.coordinatorOverdue > 0
        ? `${s.waiting.coordinatorOverdue} of them ${s.waiting.coordinatorOverdue === 1 ? "has" : "have"} waited more than a week. `
        : "";
    attention.push({
      tone: s.waiting.coordinatorOverdue > 0 ? "amber" : "blue",
      title: `${plural(s.waiting.coordinator, "request")} waiting on coordinators to verify`,
      detail: `${overdue}Coordinators get weekly reminders on their own. The club can also approve a request without them.`,
      text: `${plural(s.waiting.coordinator, "request")} waiting on coordinators to verify. ${overdue}Coordinators get weekly reminders on their own.`,
    });
  }
  if (s.members.noHours > 0 && s.members.hasGoals) {
    attention.push({
      tone: "blue",
      title: `${plural(s.members.noHours, "member")} with no approved hours yet`,
      detail: "See who on the Progress page.",
      text: `${plural(s.members.noHours, "member")} with no approved hours yet.`,
    });
  }
  if (s.waiting.club === 0 && s.waiting.coordinator === 0) {
    attention.unshift({
      tone: "green",
      title: "All caught up",
      detail: "No hour requests are waiting for review.",
      text: "All caught up: no hour requests are waiting for review.",
    });
  }

  const quiet = s.week.submitted === 0 && s.week.approved === 0 && s.week.denied === 0;

  const categoryRows = s.categories
    .filter((c) => c.averagePercent !== null)
    .map(
      (c) => `
      <tr><td style="padding:10px 0;border-bottom:2px solid ${SILVER}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font:700 14px ${FONT};color:${BLUE}">${escape(c.name)} <span style="font-weight:600;color:${GRAY}">· ${escape(formatHours(c.goal))} goal</span></td>
          <td align="right" style="font:700 13px ${FONT};color:${INK};white-space:nowrap">${c.met} of ${c.members} met</td>
        </tr></table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px"><tr>
          <td>${bar(c.averagePercent ?? 0, (c.averagePercent ?? 0) >= 100 ? GREEN : BLUE)}</td>
          <td width="52" align="right" style="font:600 12px ${FONT};color:${GRAY};white-space:nowrap">${c.averagePercent}% avg</td>
        </tr></table>
      </td></tr>`,
    );

  const html = layout({
    preview: `${plural(s.week.submitted, "request")} logged, ${formatHours(s.week.approvedHours)} approved, ${plural(s.waiting.club, "request")} waiting on the club.`,
    body: `
      ${heading(`${s.clubName} Weekly Summary`)}
      <div style="margin:-6px 0 16px;font:600 13px ${FONT};color:${GRAY}">${escape(range)}</div>
      <p style="margin:0 0 6px">${escape(greeting)}</p>
      <p style="margin:0">Here is what happened in ${escape(s.clubName)} last week, what still needs attention, and how members are doing on their goals.</p>

      ${section("Needs Attention")}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${attention.map((a) => callout(a.tone, escape(a.title), escape(a.detail))).join("")}
      </table>
      ${s.waiting.club > 0 ? button("Review Hour Requests", s.links.requests) : ""}

      ${section("Last Week")}
      ${
        quiet
          ? `<p style="margin:0;color:${GRAY}">No hours were logged or reviewed last week.</p>`
          : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:-6px 0 0">
              <tr>
                ${tile(number(s.week.submitted), "Requests Logged", `${formatHours(s.week.submittedHours)} total`)}
                ${tile(formatHours(s.week.approvedHours), "Hours Approved", `${plural(s.week.approved, "request")}`)}
              </tr>
              <tr>
                ${tile(number(s.week.studentsLogging), "Students Logging", `of ${plural(s.members.active, "active member")}`)}
                ${tile(number(s.week.denied), "Requests Denied", s.week.denied === 0 ? "none this week" : "students were emailed why")}
              </tr>
            </table>`
      }

      ${section("Club Progress")}
      ${
        s.members.hasGoals && s.members.counted > 0
          ? `<p style="margin:0 0 8px"><strong>${s.members.metAllGoals} of ${plural(s.members.counted, "member")}</strong> ${
              s.members.metAllGoals === 1 ? "has" : "have"
            } met all their goals (${metPercent}%).</p>
            ${bar(metPercent, metPercent >= 100 ? GREEN : BLUE)}
            ${categoryRows.length > 0 ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:2px solid ${SILVER}">${categoryRows.join("")}</table>` : ""}`
          : `<p style="margin:0;color:${GRAY}">${
              s.members.active === 0 ? "The club has no active members yet." : "The club has no hour goals set."
            } ${plural(s.members.active, "active member")}.</p>`
      }

      ${
        s.topStudents.length > 0
          ? `${section("Top Contributors Last Week")}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${s.topStudents
                .map(
                  (t, i) => `
                <tr>
                  <td width="28" style="padding:6px 0;font:700 14px ${FONT};color:${GRAY}">${i + 1}.</td>
                  <td style="padding:6px 0;font:600 14px ${FONT};color:${INK}">${escape(t.name)}</td>
                  <td align="right" style="padding:6px 0;font:700 14px ${FONT};color:${GREEN};white-space:nowrap">${escape(formatHours(t.hours))}</td>
                </tr>`,
                )
                .join("")}
            </table>
            <p style="margin:6px 0 0;font:600 12px ${FONT};color:${GRAY}">By hours approved last week.</p>`
          : ""
      }

      ${button("View Club Progress", s.links.progress)}`,
    footer: `You get this summary every Monday morning because you are a staff sponsor of ${escape(s.clubName)} on Royals Outreach.`,
  });

  const text = [
    `${s.clubName} weekly summary: ${range}`,
    "",
    greeting,
    "",
    "NEEDS ATTENTION",
    ...attention.map((a) => `- ${a.text}`),
    ...(s.waiting.club > 0 ? [`Review hour requests: ${s.links.requests}`] : []),
    "",
    "LAST WEEK",
    ...(quiet
      ? ["No hours were logged or reviewed last week."]
      : [
          `- Requests logged: ${s.week.submitted} (${formatHours(s.week.submittedHours)})`,
          `- Hours approved: ${formatHours(s.week.approvedHours)} (${plural(s.week.approved, "request")})`,
          `- Students logging: ${s.week.studentsLogging} of ${s.members.active}`,
          `- Requests denied: ${s.week.denied}`,
        ]),
    "",
    "CLUB PROGRESS",
    ...(s.members.hasGoals && s.members.counted > 0
      ? [
          `${s.members.metAllGoals} of ${plural(s.members.counted, "member")} met all their goals (${metPercent}%).`,
          ...s.categories
            .filter((c) => c.averagePercent !== null)
            .map((c) => `- ${c.name} (${formatHours(c.goal)} goal): ${c.met} of ${c.members} met, ${c.averagePercent}% average`),
        ]
      : [s.members.active === 0 ? "The club has no active members yet." : "The club has no hour goals set."]),
    ...(s.topStudents.length > 0
      ? ["", "TOP CONTRIBUTORS LAST WEEK", ...s.topStudents.map((t, i) => `${i + 1}. ${t.name}: ${formatHours(t.hours)}`)]
      : []),
    "",
    `View club progress: ${s.links.progress}`,
    "",
    "Royals Outreach · Hamilton Southeastern High School",
  ].join("\n");

  return { to, subject, html, text };
}
