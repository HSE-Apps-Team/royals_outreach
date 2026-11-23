import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GATE_COOKIE, gatePassword, gateToken } from "@/lib/siteGate";

export async function proxy(request: NextRequest) {
  const password = gatePassword();
  if (!password) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const unlocked = request.cookies.get(GATE_COOKIE)?.value === (await gateToken(password));

  if (unlocked || pathname === "/unlock") {
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  const url = new URL("/unlock", request.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next.js build assets, the icons and progress rings (shown in emails), the
  // coordinator page (opened from email and protected by its signed link) and the cron routes
  // (CRON_SECRET).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|coordinator|api/cron|api/email).*)"],
};
