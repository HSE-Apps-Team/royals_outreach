import { createHash } from "node:crypto";

// Sends email through Resend (https://resend.com/docs/api-reference/emails).
//
// Environment:
//   RESEND_API_KEY     required to send anything
//   EMAIL_FROM         sender, default "Royals Outreach <info@royalsoutreach.com>"
//   EMAIL_FROM_UPDATES sender of student emails, default "Royals Outreach <updates@royalsoutreach.com>"
//   EMAIL_REPLY_TO     optional address replies go to when an email does not set its own
//   EMAIL_LIVE         "true" once the site launches. Until then, production sends every email to
//                      a test inbox instead of the real person (see PRELAUNCH_INBOXES below).
//   EMAIL_REDIRECT_TO  outside production, every email goes here instead of the real person.
//                      Without it, development never sends (dry run only), so a local run
//                      can never email real students or coordinators.
//   APP_URL            site address used in links, e.g. "https://royalsoutreach.com"

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Where replies go. Falls back to EMAIL_REPLY_TO. */
  replyTo?: string[];
  /** "updates" for emails to students and staff; coordinators get the default sender. */
  sender?: "default" | "updates";
};

export type SendResult = { sent: number } | { sent: 0; error: string };

const RESEND_URL = "https://api.resend.com/emails";
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const BATCH_LIMIT = 100;
const DEFAULT_FROM = "Royals Outreach <info@royalsoutreach.com>";
const UPDATES_FROM = "Royals Outreach <updates@royalsoutreach.com>";
// Resend takes up to 50 reply-to addresses.
const MAX_REPLY_TO = 50;

// Before launch, production email goes to these inboxes instead of the real people. Everything
// goes to the personal inbox for now, since the school's filter quarantines this domain's mail;
// school addresses go back to the school test account once district IT allowlists it.
// Set EMAIL_LIVE=true at launch to send to the real people.
const SCHOOL_DOMAINS = ["hsestudents.org", "hse.k12.in.us"];
const PRELAUNCH_INBOXES = {
  school: ["sajjanithik@gmail.com"], // later: "sajjanit000@hsestudents.org"
  outside: ["sajjanithik@gmail.com"],
};

const isProduction = () => process.env.NODE_ENV === "production";
const isLive = () => isProduction() && process.env.EMAIL_LIVE === "true";

const isSchoolAddress = (email: string) =>
  SCHOOL_DOMAINS.includes(email.trim().toLowerCase().split("@").at(-1) ?? "");

/** The site address for links in emails, without a trailing slash. */
export function appUrl(): string {
  const configured = process.env.APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!configured) return "http://localhost:3000";
  const withScheme = /^https?:\/\//.test(configured) ? configured : `https://${configured}`;
  return withScheme.replace(/\/+$/, "");
}

/** Why sending is off right now, or null when emails will go out. */
export function emailDisabledReason(): string | null {
  if (!process.env.RESEND_API_KEY) return "RESEND_API_KEY is not set.";
  if (!isProduction() && !process.env.EMAIL_REDIRECT_TO) {
    return "Development only sends when EMAIL_REDIRECT_TO is set.";
  }
  return null;
}

/**
 * Where an email actually goes: the real person once EMAIL_LIVE is on, the pre-launch test
 * inboxes in production before that, and EMAIL_REDIRECT_TO in development.
 */
export function deliveryAddresses(to: string): string[] {
  if (isLive()) return [to];
  if (isProduction()) return isSchoolAddress(to) ? PRELAUNCH_INBOXES.school : PRELAUNCH_INBOXES.outside;
  return [process.env.EMAIL_REDIRECT_TO ?? to];
}

/** deliveryAddresses as one line, for dry-run previews. */
export const deliveryAddress = (to: string): string => deliveryAddresses(to).join(", ");

// Before launch, a note at the top of the body names who the email was really for. It stays
// out of the subject: a subject holding an email address looks like phishing to mail filters.
const testNote = (to: string) => `Pre-launch test: this email would have gone to ${to}.`;

const withTestNote = (html: string, to: string) => {
  const note = `<div style="padding:8px 12px;background:#fff4d6;border-bottom:1px solid #e8d49a;font:600 12px Arial, sans-serif;color:#5c4a12;text-align:center">${testNote(
    to,
  ).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`;
  return /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (tag) => tag + note) : note + html;
};

// The Resend body for one email.
const toResend = (email: OutgoingEmail) => {
  const from =
    email.sender === "updates"
      ? process.env.EMAIL_FROM_UPDATES || UPDATES_FROM
      : process.env.EMAIL_FROM || DEFAULT_FROM;
  const replyTo = email.replyTo?.length
    ? email.replyTo
    : process.env.EMAIL_REPLY_TO
      ? [process.env.EMAIL_REPLY_TO]
      : [];
  return {
    from,
    to: deliveryAddresses(email.to),
    subject: email.subject,
    html: isLive() ? email.html : withTestNote(email.html, email.to),
    text: isLive() ? email.text : `${testNote(email.to)}\n\n${email.text}`,
    ...(replyTo.length > 0 ? { reply_to: replyTo.slice(0, MAX_REPLY_TO) } : {}),
  };
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const MAX_TRIES = 3;

// One call to Resend, waiting and retrying when the team's rate limit (10 a second) is hit.
async function callResend(url: string, init: RequestInit): Promise<Response | { error: string }> {
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not reach Resend." };
    }
    if (response.status !== 429 || attempt === MAX_TRIES) return response;
    const wait = Math.min(Number(response.headers.get("retry-after")) || 1, 5);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

const errorOf = async (response: Response) =>
  `Resend returned ${response.status}: ${(await response.text()).slice(0, 300)}`;

/**
 * Sends one email, or schedules it for later with scheduledAt. The id is what cancelEmail takes.
 * By default the idempotency key comes from the content (and send time), so a retry cannot send it
 * twice. Pass idempotencyKey to name the email instead, so even a repeat with new content is sent once.
 */
export async function sendEmail(
  email: OutgoingEmail,
  { scheduledAt, idempotencyKey }: { scheduledAt?: Date; idempotencyKey?: string } = {},
): Promise<{ id: string } | { error: string }> {
  const disabled = emailDisabledReason();
  if (disabled) return { error: disabled };

  const body = { ...toResend(email), ...(scheduledAt ? { scheduled_at: scheduledAt.toISOString() } : {}) };
  const response = await callResend(RESEND_URL, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey ? hash(idempotencyKey) : hash(body) },
    body: JSON.stringify(body),
  });
  if ("error" in response) return response;
  if (!response.ok) return { error: await errorOf(response) };

  const { id } = (await response.json()) as { id?: string };
  return id ? { id } : { error: "Resend did not return an email id." };
}

/** Cancels a scheduled email. Fails once it has been sent. */
export async function cancelEmail(id: string): Promise<{ success: true } | { error: string }> {
  const disabled = emailDisabledReason();
  if (disabled) return { error: disabled };

  const response = await callResend(`${RESEND_URL}/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  if ("error" in response) return response;
  return response.ok ? { success: true } : { error: await errorOf(response) };
}

// Sends up to 100 emails in one request. The idempotency key comes from the content, so a
// retried request cannot send the same batch twice.
export async function sendEmailBatch(emails: OutgoingEmail[]): Promise<SendResult> {
  if (emails.length === 0) return { sent: 0 };
  if (emails.length > BATCH_LIMIT) return { sent: 0, error: `Send ${BATCH_LIMIT} emails or fewer at once.` };
  const disabled = emailDisabledReason();
  if (disabled) return { sent: 0, error: disabled };

  const body = emails.map(toResend);
  const response = await callResend(RESEND_BATCH_URL, {
    method: "POST",
    headers: { "Idempotency-Key": hash(body) },
    body: JSON.stringify(body),
  });
  if ("error" in response) return { sent: 0, error: response.error };
  if (!response.ok) return { sent: 0, error: await errorOf(response) };
  return { sent: emails.length };
}

/** Splits a list into Resend-sized batches. */
export function inBatches<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH_LIMIT) batches.push(items.slice(i, i + BATCH_LIMIT));
  return batches;
}
