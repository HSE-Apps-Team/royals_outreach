import React from "react";
import "bootstrap-icons/font/bootstrap-icons.css";
import { NavLockup } from "@/app/components/sideNav";
import SchoolFooter from "@/app/components/schoolFooter";
import "@/app/css/coordinator.css";

// The coordinator page opens from an email with no account, so it has no side nav:
// a navy bar with the logo on top and the HSE footer bar below.
export default function CoordinatorFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="coordinator">
      {/* Header */}
      <header className="coordinator-bar">
        <NavLockup logoHref={null} />
        <span className="coordinator-bar-note">Opened from email · No account needed</span>
      </header>

      {/* Body */}
      <main className="coordinator-body">{children}</main>

      {/* Footer */}
      <SchoolFooter />
    </div>
  );
}

/** A centered message in place of the page body (bad link, nothing to show). */
export function CoordinatorNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="coordinator-notice" role="status">
      <h1 className="coordinator-notice-title">{title}</h1>
      <p className="coordinator-notice-text">{children}</p>
    </div>
  );
}
