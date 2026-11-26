import React from "react";
import Link from "next/link";
import Image from "next/image";
import LogoButton from "./logoButton";
import LoginButton from "./loginButton";
import MobileNav from "./MobileNav";
import royalsOutreachLogo from "../assets/logo.png";
import "../css/shell.css";

export type AppHeaderLink = {
  label: string;
  href: string;
};

type AppHeaderVariant = "white" | "blue";

type AppHeaderProps = {
  links?: AppHeaderLink[];
  /** href of the active link (red with an underline). */
  activeHref?: string;
  logoHref?: string;
  /** Right-side slot; defaults to the Sign In button. Pass null to hide it. */
  action?: React.ReactNode;
  /**
   * white: logo only on a white bar. blue: HSE blue bar with the round logo, "Royals Outreach",
   * a red and white stripe under it, and the MobileNav drawer on phones (homepage).
   */
  variant?: AppHeaderVariant;
  className?: string;
};

const DEFAULT_LINKS: AppHeaderLink[] = [
  { label: "How It Works", href: "#how-it-works" },
  { label: "Why It Matters", href: "#why-it-matters" },
  { label: "Contact", href: "#contact" },
];

export default function AppHeader({
  links = DEFAULT_LINKS,
  activeHref,
  logoHref = "/",
  action = <LoginButton />,
  variant = "white",
  className = "",
}: AppHeaderProps) {
  const blue = variant === "blue";

  return (
    <>
      <header className={`app-header ${blue ? "app-header-blue" : ""} ${className}`.replace(/\s+/g, " ").trim()}>
        <div className="app-header-inner">
          {blue ? (
            <Link href={logoHref} className="app-header-brand">
              <Image src={royalsOutreachLogo} alt="" width={50} height={50} className="app-header-brand-logo" />
              Royals Outreach
            </Link>
          ) : (
            <LogoButton href={logoHref} />
          )}

          <nav className="app-header-links" aria-label="Site">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`app-header-link ${link.href === activeHref ? "app-header-link-active" : ""}`.trim()}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {action}
        </div>
      </header>

      {/* Phones: the same top bar and drawer as the signed-in pages */}
      {blue && (
        <MobileNav
          items={links.map((link) => ({ label: link.label, href: link.href }))}
          user={null}
          logoHref={logoHref}
          footer={action}
          className="app-header-mobile"
        />
      )}

      {blue && <div className="app-header-stripe" aria-hidden="true" />}
    </>
  );
}
