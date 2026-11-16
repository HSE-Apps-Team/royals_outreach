import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GATE_COOKIE, gatePassword, gateToken } from "@/lib/siteGate";

export const metadata = { title: "Royals Outreach", robots: { index: false, follow: false } };

// Only allow redirecting back to a path on this site.
function safeNext(value: FormDataEntryValue | string | undefined | null): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

async function unlock(formData: FormData) {
  "use server";
  const password = gatePassword();
  const next = safeNext(formData.get("next"));
  if (!password) redirect(next);

  if (formData.get("password") !== password) {
    redirect(`/unlock?error=1&next=${encodeURIComponent(next)}`);
  }

  (await cookies()).set(GATE_COOKIE, await gateToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(next);
}

async function UnlockForm({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <form action={unlock} className="d-flex flex-column gap-3">
      <input type="hidden" name="next" value={safeNext(next)} />
      <input
        type="password"
        name="password"
        className={`form-control${error ? " is-invalid" : ""}`}
        placeholder="Password"
        autoFocus
        required
      />
      {error && <div className="invalid-feedback d-block mt-n2">Incorrect password.</div>}
      <button type="submit" className="btn btn-primary">Enter</button>
    </form>
  );
}

export default function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  return (
    <main className="d-flex align-items-center justify-content-center min-vh-100 p-3">
      <div className="card p-4 shadow-sm" style={{ width: "100%", maxWidth: 360 }}>
        <h1 className="h5 mb-1">Royals Outreach</h1>
        <p className="text-muted small mb-3">This site isn&apos;t public yet.</p>
        <Suspense>
          <UnlockForm searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
