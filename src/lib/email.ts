import { createHash } from "node:crypto";

// Sends email through Resend (https://resend.com/docs/api-reference/emails/send-batch-emails).
//
// Environment:
//   RESEND_API_KEY     required to send anything
//   EMAIL_FROM         sender, default "Royals Outreach <info@royalsoutreach.com>"
//   EMAIL_REPLY_TO     optional address replies go to when an email does not set its own
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
};

export type SendResult = { sent: number } | { sent: 0; error: string };

const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const BATCH_LIMIT = 100;
const DEFAULT_FROM = "Royals Outreach <info@royalsoutreach.com>";

const isProduction = () => process.env.NODE_ENV === "production";

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

/** Where an email actually goes: the real person in production, EMAIL_REDIRECT_TO otherwise. */
export function deliveryAddress(to: string): string {
  return isProduction() ? to : (process.env.EMAIL_REDIRECT_TO ?? to);
}

// Sends up to 100 emails in one request. The idempotency key comes from the content, so a
// retried request cannot send the same batch twice.
export async function sendEmailBatch(emails: OutgoingEmail[]): Promise<SendResult> {
  if (emails.length === 0) return { sent: 0 };
  if (emails.length > BATCH_LIMIT) return { sent: 0, error: `Send ${BATCH_LIMIT} emails or fewer at once.` };
  const disabled = emailDisabledReason();
  if (disabled) return { sent: 0, error: disabled };

  const from = process.env.EMAIL_FROM || DEFAULT_FROM;
  const defaultReplyTo = process.env.EMAIL_REPLY_TO ? [process.env.EMAIL_REPLY_TO] : [];
  const body = emails.map((email) => {
    const replyTo = email.replyTo?.length ? email.replyTo : defaultReplyTo;
    return {
      from,
      to: [deliveryAddress(email.to)],
      subject: isProduction() ? email.subject : `[Test for ${email.to}] ${email.subject}`,
      html: email.html,
      text: email.text,
      ...(replyTo.length > 0 ? { reply_to: replyTo } : {}),
    };
  });
  const idempotencyKey = createHash("sha256").update(JSON.stringify(body)).digest("hex");

  try {
    const response = await fetch(RESEND_BATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text();
      return { sent: 0, error: `Resend returned ${response.status}: ${detail.slice(0, 300)}` };
    }
    return { sent: emails.length };
  } catch (error) {
    return { sent: 0, error: error instanceof Error ? error.message : "Could not reach Resend." };
  }
}

/** Splits a list into Resend-sized batches. */
export function inBatches<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH_LIMIT) batches.push(items.slice(i, i + BATCH_LIMIT));
  return batches;
}
