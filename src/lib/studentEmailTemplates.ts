import { appUrl, type OutgoingEmail } from "@/lib/email";
import {
  BLUE,
  FONT,
  GRAY,
  INK,
  NAVY,
  RED,
  SILVER,
  TINT,
  button,
  escape,
  heading,
  joinOr,
  layout,
  list,
  row,
  type EmailContact,
} from "@/lib/emailTemplates";
import { formatHours } from "@/lib/formatHours";
import { plural } from "@/lib/plural";

// The emails a student gets about their own hour requests. When each one is sent and who is
// listed as a contact are decided in src/lib/studentEmails.ts. Markup follows
// emailTemplates.ts: tables and inline styles.

const GREEN = "#1e7e34";
const RED_TINT = "#fdecef";

/** One logged request, as the student emails show it. Blank fields are left out. */
export type StudentEmailLog = {
  opportunity: string;
  club: string;
  category: string;
  /** "Sep 27, 2026" */
  date: string;
  hours: number;
  organization: string;
  coordinatorName: string;
  coordinatorEmail: string;
  message: string;
  denyMessage: string;
};

/** The student's progress in one category, counting this email's hours. */
export type StudentEmailProgress = {
  category: string;
  club: string;
  /** Approved hours. */
  value: number;
  /** 0 when the category has no goal. */
  goal: number;
  /** Hours still waiting on verification. */
  pending: number;
};

/** Who verifies a request next, or null when it already counts. */
export type StudentNextStep = "coordinator" | "club" | null;

type StudentEmailBase = {
  to: string;
  firstName: string;
};

//--------------------------------------------------------------------------------------//
//                                       Helpers                                        //
//--------------------------------------------------------------------------------------//

const FOOTER =
  "You get these emails when hours you log are submitted, verified or reviewed. Replies to this address are not read, so please email your club contacts instead.";

const greetingFor = (firstName: string) => (firstName ? `Hi ${firstName},` : "Hi,");

const paragraph = (html: string) => `<p style="margin:0 0 14px">${html}</p>`;

const strong = (value: string) => `<strong>${escape(value)}</strong>`;

const myRequestsLink = () => `${appUrl()}/student/requests`;

const roundHours = (hours: number) => Math.round(hours * 100) / 100;

// Keeps a long opportunity name from swallowing the subject line.
const shortName = (opportunity: string) =>
  opportunity.length > 60 ? `${opportunity.slice(0, 57).trimEnd()}...` : opportunity;

// The site's progress ring as a PNG, since mail apps do not draw SVG (src/app/api/email/ring).
const ringUrl = ({ value, goal }: StudentEmailProgress) =>
  `${appUrl()}/api/email/ring?value=${encodeURIComponent(value)}&goal=${encodeURIComponent(goal)}`;

const percentOf = (value: number, goal: number) => (goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0);

const isMet = (p: StudentEmailProgress) => p.goal > 0 && p.value >= p.goal;

// "12 of 20 hrs (60%)", or the total when the category has no goal.
const progressLine = (p: StudentEmailProgress) =>
  p.goal > 0
    ? `${p.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} of ${formatHours(p.goal)} (${percentOf(p.value, p.goal)}%)`
    : `${formatHours(p.value)} approved`;

const progressNotes = (p: StudentEmailProgress) => [
  ...(isMet(p) ? ["Goal complete!"] : []),
  ...(p.goal > 0 && !isMet(p) ? [`${formatHours(roundHours(p.goal - p.value))} to go`] : []),
  ...(p.pending > 0 ? [`${formatHours(p.pending)} still pending`] : []),
];

// A card per category: the ring on the left, the numbers on the right.
const progressHtml = (progress: StudentEmailProgress[]) => {
  if (progress.length === 0) return "";
  const cards = progress.map((p) => {
    const ring =
      p.goal > 0
        ? `<td width="124" valign="middle" style="padding-right:16px"><img src="${escape(ringUrl(p))}" width="120" height="120" alt="${escape(progressLine(p))}" style="display:block;border:0"></td>`
        : "";
    const notes = progressNotes(p)
      .map(
        (note) =>
          `<div style="font-weight:600;color:${note === "Goal complete!" ? GREEN : GRAY}">${escape(note)}</div>`,
      )
      .join("");
    return `
      <tr><td style="padding:14px 16px;border-radius:8px;background:${TINT}">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${ring}
          <td valign="middle" style="font:400 14px/1.5 ${FONT};color:${INK}">
            <div style="font:600 12px ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${GRAY}">${escape(p.club)}</div>
            <div style="font:700 17px/1.3 ${FONT};color:${BLUE};margin:2px 0 6px">${escape(p.category)}</div>
            <div style="font-weight:700;color:${isMet(p) ? GREEN : INK}">${escape(progressLine(p))}</div>
            ${notes}
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="height:10px;line-height:10px;font-size:0">&nbsp;</td></tr>`;
  });
  return `
    <h2 style="margin:22px 0 10px;font:700 16px ${FONT};color:${NAVY}">Your Progress</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards.join("")}</table>`;
};

const progressText = (progress: StudentEmailProgress[]) =>
  progress.length === 0
    ? []
    : [
        "",
        "Your progress:",
        ...progress.map((p) => `- ${p.category} (${p.club}): ${[progressLine(p), ...progressNotes(p)].join(", ")}`),
      ];

// Every field the student entered, label on the left.
const detailRows = (log: StudentEmailLog): [string, string][] =>
  (
    [
      ["Opportunity", log.opportunity],
      ["Organization", log.organization],
      ["Date", log.date],
      ["Hours", formatHours(log.hours)],
      ["Club", log.club],
      ["Category", log.category],
      [
        "Coordinator",
        [log.coordinatorName, log.coordinatorEmail && `(${log.coordinatorEmail})`].filter(Boolean).join(" "),
      ],
      ["Your Note", log.message],
    ] as [string, string][]
  ).filter(([, value]) => value);

const detailHtml = (log: StudentEmailLog) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid ${SILVER};margin:4px 0 6px">
    ${detailRows(log)
      .map(
        ([label, value]) => `
      <tr>
        <td valign="top" style="padding:9px 12px 9px 0;border-bottom:2px solid ${SILVER};width:120px;font:600 13px/1.45 ${FONT};color:${GRAY}">${escape(label)}</td>
        <td valign="top" style="padding:9px 0;border-bottom:2px solid ${SILVER};font:600 14px/1.45 ${FONT};color:${INK}">${escape(value)}</td>
      </tr>`,
      )
      .join("")}
  </table>`;

const detailText = (log: StudentEmailLog) => detailRows(log).map(([label, value]) => `${label}: ${value}`);

const reasonHtml = (reason: string) =>
  reason
    ? `<div style="margin:0 0 14px;padding:10px 12px;border-radius:6px;background:${RED_TINT};border-left:4px solid ${RED};font-size:14px"><strong>Reason:</strong> ${escape(reason)}</div>`
    : "";

// The club's staff sponsors and execs, listed in the body instead of a Reply-To: a reply going
// to district addresses from an outside sender looks like impersonation to the school's filter.
const contactHtml = (contacts: EmailContact[]) =>
  contacts.length > 0
    ? paragraph(
        `If you have questions, contact ${joinOr(
          contacts.map(
            (s) =>
              `${escape(s.name)} <a href="mailto:${escape(s.email)}" style="color:${BLUE};font-weight:600">${escape(s.email)}</a>`,
          ),
        )}.`,
      )
    : "";

const contactText = (contacts: EmailContact[]) =>
  contacts.length > 0 ? ["", `If you have questions, contact ${joinOr(contacts.map((s) => `${s.name} ${s.email}`))}.`] : [];

const textEmail = (lines: string[]) =>
  [...lines, "", `See all your requests: ${myRequestsLink()}`, "", "Royals Outreach · Hamilton Southeastern High School"].join(
    "\n",
  );

// The same sentence as HTML (names bolded) and as plain text.
type Both = { html: string; text: string };
const both = (parts: (string | { bold: string })[]): Both => ({
  html: parts.map((p) => (typeof p === "string" ? escape(p) : strong(p.bold))).join(""),
  text: parts.map((p) => (typeof p === "string" ? p : p.bold)).join(""),
});

//--------------------------------------------------------------------------------------//
//                                    Log Submitted                                     //
//--------------------------------------------------------------------------------------//

// Right after the student logs hours. Hours that need no verification count at once, so that
// email confirms the log and shows the progress in one.
export function studentLogSubmittedEmail({
  to,
  firstName,
  log,
  next,
  clubReviewsAfter = false,
  progress = [],
  contacts = [],
}: StudentEmailBase & {
  log: StudentEmailLog;
  next: StudentNextStep;
  /** The club reviews it after the coordinator verifies it. */
  clubReviewsAfter?: boolean;
  progress?: StudentEmailProgress[];
  /** The club's staff sponsors and execs, for questions. */
  contacts?: EmailContact[];
}): OutgoingEmail {
  const counted = next === null;
  const subject = `${counted ? "Hours logged" : "Hours submitted"}: ${shortName(log.opportunity)}`;
  const intro = both(["Your hours for ", { bold: log.club }, ` were ${counted ? "logged" : "submitted"}. Here is what you entered:`]);

  const coordinator = log.coordinatorName || "your coordinator";
  const nextStep =
    next === "coordinator"
      ? both([
          "Next, we will email ",
          { bold: coordinator },
          ...(log.coordinatorEmail ? [" at ", { bold: log.coordinatorEmail }] : []),
          " to verify your hours.",
          ...(clubReviewsAfter ? [" After that, ", { bold: log.club }, " will review them."] : []),
          " We will email you when they do.",
        ])
      : next === "club"
        ? both(["Next, ", { bold: log.club }, " will review your hours. We will email you when they do."])
        : both(["These hours did not need verification, so they already count toward your goal."]);

  const html = layout({
    preview: `${formatHours(log.hours)} ${counted ? "logged and counted" : "submitted"} for ${log.club}.`,
    body: `
      ${heading(counted ? "Hours Logged" : "Hours Submitted")}
      ${paragraph(escape(greetingFor(firstName)))}
      ${paragraph(intro.html)}
      ${detailHtml(log)}
      <p style="margin:14px 0">${nextStep.html}</p>
      ${contactHtml(contacts)}
      ${progressHtml(progress)}
      ${button("View My Requests", myRequestsLink())}`,
    footer: counted
      ? FOOTER
      : `${FOOTER} If something here is wrong, you can edit or delete the request on My Requests until it is verified.`,
  });

  const text = textEmail([
    greetingFor(firstName),
    "",
    intro.text,
    "",
    ...detailText(log),
    "",
    nextStep.text,
    ...contactText(contacts),
    ...progressText(progress),
  ]);

  return { to, subject, html, text };
}

//--------------------------------------------------------------------------------------//
//                                 Coordinator Decision                                 //
//--------------------------------------------------------------------------------------//

// The coordinator answered on the coordinator page.
export function studentCoordinatorDecisionEmail({
  to,
  firstName,
  log,
  approved,
  waitingOnClub,
  progress = [],
  contacts = [],
}: StudentEmailBase & {
  log: StudentEmailLog;
  approved: boolean;
  /** Approved, and the club still has to confirm it. */
  waitingOnClub: boolean;
  /** Shown once the hours count (approved with no club step). */
  progress?: StudentEmailProgress[];
  /** The club's staff sponsors and execs, for questions. */
  contacts?: EmailContact[];
}): OutgoingEmail {
  const coordinator = log.coordinatorName || "Your coordinator";
  const verb = approved ? "verified" : "did not verify";
  const subject = `${coordinator} ${verb} your hours for ${shortName(log.opportunity)}`;

  // "<coordinator> verified log for <opportunity> that took place on <date> at <org>."
  const summary = both([
    { bold: coordinator },
    ` ${verb} your log for `,
    { bold: log.opportunity },
    ...(log.date ? [` that took place on ${log.date}`] : []),
    ...(log.organization ? [" at ", { bold: log.organization }] : []),
    ".",
  ]);
  const clubLine = `Club: ${[log.club, log.category, formatHours(log.hours)].filter(Boolean).join(" · ")}`;
  const nextStep = !approved
    ? both(["These hours will not count toward your goal. If you think this is a mistake, you can log them again with the right details."])
    : waitingOnClub
      ? both(["It is now waiting for confirmation from ", { bold: log.club }, ". We will email you when they review it."])
      : both(["These hours now count toward your goal."]);

  const html = layout({
    preview: summary.text,
    body: `
      ${heading(approved ? "Hours Verified" : "Hours Not Verified")}
      ${paragraph(escape(greetingFor(firstName)))}
      ${paragraph(summary.html)}
      ${approved ? "" : reasonHtml(log.denyMessage)}
      ${paragraph(`<span style="color:${GRAY};font-weight:600">${escape(clubLine)}</span>`)}
      ${paragraph(nextStep.html)}
      ${contactHtml(contacts)}
      ${progressHtml(progress)}
      ${button("View My Requests", myRequestsLink())}`,
    footer: FOOTER,
  });

  const text = textEmail([
    greetingFor(firstName),
    "",
    summary.text,
    ...(!approved && log.denyMessage ? [`Reason: ${log.denyMessage}`] : []),
    clubLine,
    "",
    nextStep.text,
    ...contactText(contacts),
    ...progressText(progress),
  ]);

  return { to, subject, html, text };
}

//--------------------------------------------------------------------------------------//
//                                    Club Decision                                     //
//--------------------------------------------------------------------------------------//

// The club approved or denied one or more of the student's requests. It goes out a few
// minutes later, so an Undo can still cancel it.
export function studentClubDecisionEmail({
  to,
  firstName,
  club,
  approved,
  logs,
  progress = [],
  contacts = [],
}: StudentEmailBase & {
  club: string;
  approved: boolean;
  logs: StudentEmailLog[];
  /** Approvals only: each category the hours counted toward. */
  progress?: StudentEmailProgress[];
  /** The club's staff sponsors and execs, for questions. */
  contacts?: EmailContact[];
}): OutgoingEmail {
  const one = logs.length === 1;
  const total = roundHours(logs.reduce((sum, l) => sum + l.hours, 0));
  const what = one ? `your hours for ${shortName(logs[0].opportunity)}` : `${logs.length} of your hour requests`;
  const subject = `${club} ${approved ? "approved" : "did not approve"} ${what}`;

  const intro = approved
    ? both([
        { bold: club },
        ` approved ${one ? "your hours" : `${logs.length} of your requests (${formatHours(total)} in all)`}. ${one ? "They" : "These hours"} now count toward your goal.`,
      ])
    : both([
        { bold: club },
        ` did not approve ${one ? "your hours" : `${logs.length} of your requests`}, so ${one ? "they" : "these hours"} will not count toward your goal.`,
      ]);

  const rows = logs.map((l) =>
    row(
      escape(l.opportunity),
      [
        `<span style="color:${GRAY};font-weight:600;font-size:13px">${escape([l.date, l.organization, l.category].filter(Boolean).join(" · "))}</span>`,
        ...(!approved && l.denyMessage
          ? [`<div style="margin-top:6px;padding:8px 10px;border-radius:6px;background:${RED_TINT};font-size:13px"><strong>Reason:</strong> ${escape(l.denyMessage)}</div>`]
          : []),
      ],
      `<span style="color:${approved ? GREEN : RED}">${escape(formatHours(l.hours))}</span>`,
    ),
  );

  const html = layout({
    preview: approved ? `${formatHours(total)} approved by ${club}.` : `${club} did not approve ${plural(logs.length, "request")}.`,
    body: `
      ${heading(approved ? "Hours Approved" : "Hours Not Approved")}
      ${paragraph(escape(greetingFor(firstName)))}
      ${paragraph(intro.html)}
      ${list(rows)}
      <div style="height:14px;line-height:14px;font-size:0">&nbsp;</div>
      ${contactHtml(contacts)}
      ${progressHtml(progress)}
      ${button("View My Requests", myRequestsLink())}`,
    footer: FOOTER,
  });

  const text = textEmail([
    greetingFor(firstName),
    "",
    intro.text,
    "",
    ...logs.map(
      (l) =>
        `- ${l.opportunity}: ${[l.date, l.organization, l.category, formatHours(l.hours)].filter(Boolean).join(", ")}${
          !approved && l.denyMessage ? `\n  Reason: ${l.denyMessage}` : ""
        }`,
    ),
    ...contactText(contacts),
    ...progressText(progress),
  ]);

  return { to, subject, html, text };
}

//--------------------------------------------------------------------------------------//
//                                    Added To Club                                     //
//--------------------------------------------------------------------------------------//

/** A category of the club the student joined, with what its hours need. */
export type StudentEmailCategory = {
  name: string;
  /** 0 when the category has no goal. */
  goal: number;
  needsEmailVerification: boolean;
  needsClubConfirmation: boolean;
};

const verificationNote = (c: StudentEmailCategory) =>
  c.needsEmailVerification && c.needsClubConfirmation
    ? "Verified by your coordinator, then the club"
    : c.needsEmailVerification
      ? "Verified by your coordinator"
      : c.needsClubConfirmation
        ? "Verified by the club"
        : "Counts as soon as you log it";

// A club added the student (or added them back after they were inactive).
export function studentAddedToClubEmail({
  to,
  firstName,
  club,
  categories,
  contacts = [],
}: StudentEmailBase & {
  club: string;
  categories: StudentEmailCategory[];
  /** The club's staff sponsors and execs, for questions. */
  contacts?: EmailContact[];
}): OutgoingEmail {
  const subject = `You were added to ${club}`;
  const intro = both([
    "You were added to ",
    { bold: club },
    " on Royals Outreach. You can now log volunteer hours for the club and track your progress toward its goals.",
  ]);
  const logLink = `${appUrl()}/student/log`;

  const rows = categories.map((c) =>
    row(
      escape(c.name),
      [`<span style="color:${GRAY};font-weight:600;font-size:13px">${escape(verificationNote(c))}</span>`],
      c.goal > 0 ? `${escape(formatHours(c.goal))} goal` : "",
    ),
  );

  const html = layout({
    preview: `You can now log hours for ${club}.`,
    body: `
      ${heading(`Welcome to ${club}`)}
      ${paragraph(escape(greetingFor(firstName)))}
      ${paragraph(intro.html)}
      ${
        categories.length > 0
          ? `<h2 style="margin:18px 0 10px;font:700 16px ${FONT};color:${NAVY}">Hour Categories</h2>${list(rows)}<div style="height:14px;line-height:14px;font-size:0">&nbsp;</div>`
          : ""
      }
      ${contactHtml(contacts)}
      ${button("Log Hours", logLink)}`,
    footer:
      "You get this email when a club adds you on Royals Outreach. Replies to this address are not read, so please email your club contacts instead.",
  });

  const text = [
    greetingFor(firstName),
    "",
    intro.text,
    ...(categories.length > 0
      ? [
          "",
          "Hour categories:",
          ...categories.map(
            (c) => `- ${c.name}${c.goal > 0 ? ` (${formatHours(c.goal)} goal)` : ""}: ${verificationNote(c)}`,
          ),
        ]
      : []),
    ...contactText(contacts),
    "",
    `Log hours: ${logLink}`,
    "",
    "Royals Outreach · Hamilton Southeastern High School",
  ].join("\n");

  return { to, subject, html, text };
}
