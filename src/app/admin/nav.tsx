"use client";

import { usePathname } from "next/navigation";
import SideNav, { type SideNavItem, type SideNavUser } from "@/app/components/sideNav";
import MobileNav from "@/app/components/MobileNav";

const ADMIN_ITEMS: SideNavItem[] = [
  { value: "home", label: "Home", icon: "house", href: "/admin" },
  { value: "clubs", label: "All Clubs", shortLabel: "Clubs", icon: "people", href: "/admin/clubs" },
  { value: "lookup", label: "Look Up Students", shortLabel: "Look Up", icon: "search", href: "/admin/lookup" },
  { value: "reports", label: "Reports", icon: "file-earmark-bar-graph", href: "/admin/reports" },
];

type AdminNavUIProps = {
  user: SideNavUser | null;
};

export default function AdminNavUI({ user }: AdminNavUIProps) {
  const pathname = usePathname();
  const section = ADMIN_ITEMS.find((item) => item.href === pathname)?.value;

  return (
    <>
      <SideNav items={ADMIN_ITEMS} value={section} user={user} />
      <MobileNav items={ADMIN_ITEMS} value={section} user={user} />
    </>
  );
}
