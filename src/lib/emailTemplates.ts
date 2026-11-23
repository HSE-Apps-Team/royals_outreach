import { appUrl, type OutgoingEmail } from "@/lib/email";
import { formatHours } from "@/lib/formatHours";
import { plural } from "@/lib/plural";

// Email markup is tables and inline styles, since mail apps ignore stylesheets.
// Colors are the brand tokens from globals.css.
export const NAVY = "#0b264f";
export const BLUE = "#164998";
export const RED = "#d10f2f";
export const SILVER = "#c8ccd3";
export const GRAY = "#5c6168";
export const INK = "#1f2937";
export const TINT = "#eef3fa";
export const FONT = "Poppins, 'Segoe UI', Arial, sans-serif";

/** A staff sponsor of a club, listed as the contact for questions. */
export type EmailContact = {
  name: string;
  email: string;
};

export type CoordinatorDigestRequest = {
  student: string;
  opportunity: string;
  /** "Sep 27, 2026" */
  date: string;
  hours: number;
  message: string;
};


//--------------------------------------------------------------------------------------//
//                                       Helpers                                        //
//--------------------------------------------------------------------------------------//

export const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const button = (label: string, href: string) => `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px">
    <tr><td style="background:${BLUE};border-radius:6px">
      <a href="${escape(href)}" style="display:inline-block;padding:12px 22px;font:600 15px ${FONT};color:#ffffff;text-decoration:none">${escape(label)}</a>
    </td></tr>
  </table>`;

// The navy header with the logo, a white body and a short footer line.
export const layout = ({ preview, body, footer }: { preview: string; body: string; footer: string }) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Royals Outreach</title></head>
<body style="margin:0;padding:0;background:#eceef2">
  <div style="display:none;max-height:0;overflow:hidden">${escape(preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eceef2;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">
        <tr><td style="background:${NAVY};padding:16px 24px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:12px"><img src="${appUrl()}/icon.png" width="44" height="44" alt="" style="display:block;border-radius:50%;background:#ffffff"></td>
            <td style="font:700 19px/1 Georgia, 'Times New Roman', serif;letter-spacing:.06em;color:#ffffff">ROYALS<div style="font:700 9px/1 ${FONT};letter-spacing:.24em;margin-top:5px;color:${SILVER}">OUTREACH</div></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 28px 8px;font:400 15px/1.55 ${FONT};color:${INK}">${body}</td></tr>
        <tr><td style="padding:16px 28px 24px;font:600 12px/1.5 ${FONT};color:${GRAY}">${footer}</td></tr>
        <tr><td style="background:${NAVY};border-top:4px solid ${RED};padding:14px 28px;font:600 12px/1.4 ${FONT};color:${SILVER}">Hamilton Southeastern High School · Fishers, IN</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// "A, B, or C" for a list of names.
export const joinOr = (items: string[]) =>
  items.length <= 2 ? items.join(" or ") : `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;

export const heading = (text: string) =>
  `<h1 style="margin:0 0 12px;font:700 22px/1.25 ${FONT};color:${BLUE}">${escape(text)}</h1>`;

// One request as a row with a silver divider, matching the app's borderless lists.
export const row = (title: string, lines: string[], side: string) => `
  <tr><td style="padding:12px 0;border-bottom:2px solid ${SILVER}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font:400 14px/1.45 ${FONT};color:${INK}">
        <div style="font-weight:700;color:${BLUE}">${title}</div>
        ${lines.map((line) => `<div>${line}</div>`).join("")}
      </td>
      <td align="right" valign="top" style="padding-left:12px;white-space:nowrap;font:700 14px ${FONT};color:${INK}">${side}</td>
    </tr></table>
  </td></tr>`;

export const list = (rows: string[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid ${SILVER}">${rows.join("")}</table>`;

//--------------------------------------------------------------------------------------//
//                                 Coordinator Digest                                   //
//--------------------------------------------------------------------------------------//

// Once a day, every request still waiting on the coordinator, sent only when one is new.
export function coordinatorDigestEmail({
  to,
  coordinatorName,
  orgName,
  link,
  reminder = false,
  requests,
  sponsors,
}: {
  to: string;
  coordinatorName: string;
  orgName: string;
  link: string;
  /** A weekly reminder about requests they were already emailed about. */
  reminder?: boolean;
  requests: CoordinatorDigestRequest[];
  /** Staff assigned to the clubs in the email. Replies go to them too. */
  sponsors: EmailContact[];
}): OutgoingEmail {
  const count = plural(requests.length, "request");
  const subject =
    (reminder ? "Reminder: " : "") +
    (requests.length === 1
      ? `Please confirm volunteer hours for ${requests[0].student}`
      : `Please confirm ${requests.length} volunteer hour requests`);
  const greeting = coordinatorName ? `Hi ${coordinatorName},` : "Hello,";
  const forOrg = orgName ? ` at ${orgName}` : "";

  const html = layout({
    preview: `${count} waiting for you to confirm.`,
    body: `
      ${heading("Confirm Volunteer Hours")}
      <p style="margin:0 0 12px">${escape(greeting)}</p>
      <p style="margin:0 0 20px">Hamilton Southeastern students listed you as the coordinator for volunteer work${escape(forOrg)}. Please confirm whether these hours are right. It takes one click per request, and you do not need an account.</p>
      ${list(
        requests.map((r) =>
          row(
            escape(r.student),
            [
              escape(r.opportunity),
              `<span style="color:${GRAY};font-weight:600;font-size:13px">${escape(r.date)}</span>`,
              ...(r.message
                ? [`<div style="margin-top:6px;padding:8px 10px;border-radius:6px;background:${TINT};font-size:13px"><strong>Note from student:</strong> ${escape(r.message)}</div>`]
                : []),
            ],
            escape(formatHours(r.hours)),
          ),
        ),
      )}
      ${button(requests.length === 1 ? "Review Request" : `Review ${requests.length} Requests`, link)}
      ${
        sponsors.length > 0
          ? `<p style="margin:16px 0 0">With any questions, contact: ${joinOr(
              sponsors.map(
                (s) =>
                  `${escape(s.name)} <a href="mailto:${escape(s.email)}" style="color:${BLUE};font-weight:600">${escape(s.email)}</a>`,
              ),
            )}.</p>`
          : ""
      }
      <p style="margin:12px 0 0">Thank you for helping us verify service hours.</p>`,
    footer: `You get one email the morning after a student names you, then a weekly reminder until you answer. This link is just for you, so please do not forward it.`,
  });

  const text = [
    greeting,
    "",
    `Hamilton Southeastern students listed you as the coordinator for volunteer work${forOrg}. Please confirm whether these hours are right:`,
    "",
    ...requests.map((r) => `- ${r.student}: ${r.opportunity}, ${r.date}, ${formatHours(r.hours)}${r.message ? `\n  Note from student: ${r.message}` : ""}`),
    "",
    `Review them here (no account needed): ${link}`,
    "",
    ...(sponsors.length > 0
      ? [`With any questions, contact: ${joinOr(sponsors.map((s) => `${s.name} ${s.email}`))}.`, ""]
      : []),
    "Thank you for helping us verify service hours.",
    "Royals Outreach · Hamilton Southeastern High School",
  ].join("\n");

  return { to, subject, html, text, replyTo: sponsors.map((s) => s.email) };
}
