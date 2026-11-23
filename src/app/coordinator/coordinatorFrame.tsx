import React from "react";
import Image from "next/image";
import "bootstrap-icons/font/bootstrap-icons.css";
import { NavLockup } from "@/app/components/sideNav";
import lionHead from "@/app/assets/lionHead.png";
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
      <footer className="coordinator-footer">
        <Image
          src={lionHead}
          alt="Hamilton Southeastern High School Royals lion head logo"
          height={112}
          className="coordinator-footer-lion"
        />
        <div className="coordinator-footer-school">
          <div className="coordinator-footer-name">Hamilton Southeastern High School</div>
          <div className="coordinator-footer-motto">
            <span className="coordinator-footer-motto-rule" aria-hidden="true" />
            Home Of The Royals
          </div>
        </div>
        <div className="coordinator-footer-divider" aria-hidden="true" />
        <address className="coordinator-footer-contact">
          <span>
            <i className="bi bi-geo-alt-fill" aria-hidden="true" />
            12499 Olio Road, Fishers, IN 46037
          </span>
          <span>
            <i className="bi bi-telephone-fill" aria-hidden="true" />
            Office (317) 594-4190
          </span>
          <span>
            <i className="bi bi-printer-fill" aria-hidden="true" />
            Fax (317) 594-4199
          </span>
        </address>
      </footer>
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
