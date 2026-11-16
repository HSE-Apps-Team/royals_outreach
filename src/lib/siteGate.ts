// Pre-launch password gate. When SITE_PASSWORD is set (on the deployed site),
// every page requires the password first; locally, leave it unset and nothing is gated.
// Remove this file, src/proxy.ts and src/app/unlock once the app goes public.

export const GATE_COOKIE = "site_gate";

export function gatePassword(): string | undefined {
  return process.env.SITE_PASSWORD || undefined;
}

// The cookie holds a hash of the password, so changing SITE_PASSWORD signs everyone out.
export async function gateToken(password: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`royals-gate:${password}`));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
