"use client";

import { usePathname } from "next/navigation";
import SideNav, { type SideNavItem, type SideNavUser } from "@/app/components/sideNav";
import MobileNav from "@/app/components/MobileNav";

const STAFF_ITEMS: SideNavItem[] = [
  { value: "home", label: "Home", icon: "house", href: "/staff" },
  { value: "clubs", label: "All Clubs", shortLabel: "Clubs", icon: "people", href: "/staff/clubs" },
  { value: "lookup", label: "Look Up Students", shortLabel: "Look Up", icon: "search", href: "/staff/lookup" },
];

type StaffNavUIProps = {
  user: SideNavUser | null;
};

export default function StaffNavUI({ user }: StaffNavUIProps) {
  const pathname = usePathname();
  const section = STAFF_ITEMS.find((item) => item.href === pathname)?.value;

  return (
    <>
      <SideNav items={STAFF_ITEMS} value={section} user={user} />
      <MobileNav items={STAFF_ITEMS} value={section} user={user} />
    </>
  );
}
