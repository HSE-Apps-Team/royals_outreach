"use client";

import "bootstrap-icons/font/bootstrap-icons.css";
import "../css/components.css";

type PagerProps = {
  /** Current page, starting at 1. */
  page?: number;
  /** Total number of items across every page. */
  total?: number;
  perPage?: number;
  onChange?: (page: number) => void;
  ariaLabel?: string;
  className?: string;
};

type PageButton = { kind: "page"; page: number } | { kind: "gap"; key: string };

// First, last and the pages next to the current one; the rest collapse to "...".
function pageButtons(page: number, pageCount: number): PageButton[] {
  const pages: number[] = [];
  for (let n = 1; n <= pageCount; n++) {
    if (n === 1 || n === pageCount || Math.abs(n - page) <= 1) pages.push(n);
  }

  const buttons: PageButton[] = [];
  pages.forEach((n, i) => {
    if (i > 0 && n - pages[i - 1] > 1) buttons.push({ kind: "gap", key: `gap-${n}` });
    buttons.push({ kind: "page", page: n });
  });
  return buttons;
}

/** Hidden when every item fits on one page. */
export default function Pager({
  page = 2,
  total = 34,
  perPage = 10,
  onChange = () => {},
  ariaLabel = "Pages",
  className = "",
}: PagerProps) {
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  if (total <= perPage) return null;

  const current = Math.min(Math.max(1, page), pageCount);
  const atStart = current <= 1;
  const atEnd = current >= pageCount;
  const go = (n: number) => onChange(Math.min(Math.max(1, n), pageCount));

  return (
    <nav className={`pager ${className}`.trim()} aria-label={ariaLabel}>
      {/* Range */}
      <div className="pager-range">
        Showing {(current - 1) * perPage + 1} to {Math.min(current * perPage, total)} of {total}
      </div>

      {/* Buttons */}
      <div className="pager-buttons">
        <button type="button" className="pager-button" onClick={() => go(1)} disabled={atStart} aria-label="First page">
          <i className="bi bi-chevron-double-left" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pager-button"
          onClick={() => go(current - 1)}
          disabled={atStart}
          aria-label="Previous page"
        >
          <i className="bi bi-chevron-left" aria-hidden="true" />
        </button>
        {pageButtons(current, pageCount).map((b) =>
          b.kind === "gap" ? (
            <span key={b.key} className="pager-gap" aria-hidden="true">
              ...
            </span>
          ) : (
            <button
              key={b.page}
              type="button"
              className={`pager-button ${b.page === current ? "pager-button-current" : ""}`.trim()}
              onClick={() => go(b.page)}
              aria-label={`Page ${b.page}`}
              aria-current={b.page === current ? "page" : undefined}
            >
              {b.page}
            </button>
          ),
        )}
        <button
          type="button"
          className="pager-button"
          onClick={() => go(current + 1)}
          disabled={atEnd}
          aria-label="Next page"
        >
          <i className="bi bi-chevron-right" aria-hidden="true" />
        </button>
        <button type="button" className="pager-button" onClick={() => go(pageCount)} disabled={atEnd} aria-label="Last page">
          <i className="bi bi-chevron-double-right" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
