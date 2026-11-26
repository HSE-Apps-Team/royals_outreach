import React from "react";
import Image from "next/image";
import "bootstrap-icons/font/bootstrap-icons.css";
import lionHead from "../assets/lionHead.png";
import "../css/shell.css";

export type SchoolFooterLine = {
  /** Bootstrap Icons name without the `bi-` prefix. */
  icon: string;
  text: React.ReactNode;
};

type SchoolFooterProps = {
  lines?: SchoolFooterLine[];
  /** Darker strip under the footer (homepage credits). Omit to hide it. */
  bottom?: React.ReactNode;
  className?: string;
};

const DEFAULT_LINES: SchoolFooterLine[] = [
  { icon: "geo-alt-fill", text: "12499 Olio Road, Fishers, IN 46037" },
  { icon: "telephone-fill", text: "Office (317) 594-4190" },
  { icon: "printer-fill", text: "Fax (317) 594-4199" },
];

// Navy HSE footer with the lion head, school name and contact lines (coordinator page, homepage)
export default function SchoolFooter({ lines = DEFAULT_LINES, bottom, className = "" }: SchoolFooterProps) {
  return (
    <footer className={`school-footer ${className}`.trim()}>
      {/* Body */}
      <div className="school-footer-main">
        <Image
          src={lionHead}
          alt="Hamilton Southeastern High School Royals lion head logo"
          height={112}
          className="school-footer-lion"
        />
        <div className="school-footer-school">
          <div className="school-footer-name">Hamilton Southeastern High School</div>
          <div className="school-footer-motto">
            <span className="school-footer-motto-rule" aria-hidden="true" />
            Home Of The Royals
          </div>
        </div>
        <div className="school-footer-divider" aria-hidden="true" />
        <address className="school-footer-contact">
          {lines.map((line, i) => (
            <span key={i}>
              <i className={`bi bi-${line.icon}`} aria-hidden="true" />
              {line.text}
            </span>
          ))}
        </address>
      </div>

      {/* Footer */}
      {bottom && <div className="school-footer-bottom">{bottom}</div>}
    </footer>
  );
}
