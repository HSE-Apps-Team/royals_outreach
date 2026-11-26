"use client";

import { usePathname } from "next/navigation";
import SideNav, { STUDENT_NAV_ITEMS, type SideNavUser } from "@/app/components/sideNav";
import MobileNav from "@/app/components/MobileNav";

const STUDENT_ROUTES: Record<string, string> = {
  home: "/student",
  log: "/student/log",
  hours: "/student/goals",
  req: "/student/requests",
  events: "/student/events",
  opps: "/student/opportunities",
  export: "/student/export",
};

type StudentNavUIProps = {
  user: SideNavUser | null;
  /** Shown on My Requests; no badge at zero. */
  pendingRequests: number;
  /** Shown on My Events: required events today; no badge at zero. */
  eventsToday: number;
};

export default function StudentNavUI({ user, pendingRequests, eventsToday }: StudentNavUIProps) {
  const pathname = usePathname();
  const section = Object.keys(STUDENT_ROUTES).find((value) => STUDENT_ROUTES[value] === pathname);

  const badges: Record<string, number> = { req: pendingRequests, events: eventsToday };

  const ITEMS = STUDENT_NAV_ITEMS.map((item) =>
    item.value
      ? {
          ...item,
          href: STUDENT_ROUTES[item.value],
          badge: badges[item.value] > 0 ? badges[item.value] : undefined,
        }
      : item,
  );

  return (
    <>
      <SideNav items={ITEMS} value={section} user={user} />
      <MobileNav items={ITEMS} value={section} user={user} />
    </>
  );
}
