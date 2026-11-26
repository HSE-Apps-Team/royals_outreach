"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Focus handling for the scanner and its popups, which stack on top of each other.
// Focuses `initialFocus` (or the panel) on open and puts focus back on close. While `active`,
// Escape calls onEscape and Tab stays inside the panel; a popup open on top sets active to
// false on the one under it, so one Escape only closes the top popup.
export function useDialogFocus(
  panelRef: RefObject<HTMLElement | null>,
  { active = true, onEscape, initialFocus }: {
    active?: boolean;
    onEscape: () => void;
    initialFocus?: RefObject<HTMLElement | null>;
  },
) {
  const activeRef = useRef(active);
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    activeRef.current = active;
    escapeRef.current = onEscape;
  });

  // Focus on open, lock body scroll, and restore both on close
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (initialFocus?.current ?? panelRef.current)?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
    // Runs once per open; the refs are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!activeRef.current || !panelRef.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        escapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => item.offsetParent !== null,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      } else if (!panel.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [panelRef]);
}
