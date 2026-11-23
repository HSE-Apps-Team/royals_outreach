import { createHmac, timingSafeEqual } from "node:crypto";

// Coordinators have no account. The email they get links to /coordinator/<token>, where the
// token is their email plus an HMAC of it, so only someone holding the link can act for them.
// Set COORDINATOR_LINK_SECRET on the deployed site; changing it breaks every link sent so far.

const DEV_SECRET = "royals-outreach-dev-coordinator-secret";

function linkSecret(): string | null {
  const secret = process.env.COORDINATOR_LINK_SECRET;
  if (secret) return secret;
  return process.env.NODE_ENV === "production" ? null : DEV_SECRET;
}

function sign(email: string, secret: string): string {
  return createHmac("sha256", secret).update(`coordinator:${email}`).digest("base64url");
}

const normalize = (email: string) => email.trim().toLowerCase();

/** The token for a coordinator's link, or null when no secret is set in production. */
export function coordinatorToken(email: string): string | null {
  const secret = linkSecret();
  if (!secret) return null;
  const clean = normalize(email);
  return `${Buffer.from(clean).toString("base64url")}.${sign(clean, secret)}`;
}

/** The coordinator's email when the token is genuine, otherwise null. */
export function coordinatorEmailFromToken(token: string): string | null {
  const secret = linkSecret();
  if (!secret || typeof token !== "string") return null;

  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra !== undefined) return null;

  const email = normalize(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!email.includes("@")) return null;

  const expected = Buffer.from(sign(email, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? email : null;
}
