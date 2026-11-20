"use client";

import { createContext, useCallback, useContext, useState } from "react";

export type ToastType = "success" | "danger" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** A button in the toast, e.g. Undo. Clicking it also closes the toast. */
  action?: ToastAction;
  /** How long the toast stays up, in milliseconds. */
  duration?: number;
}

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

export interface ToastContextType {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
  removeToast: (id: number) => void;
}

const MAX_VISIBLE_TOASTS = 3;

const ToastContext = createContext<ToastContextType | null>(null);

let toastIdCounter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "success", options: ToastOptions = {}) => {
      const id = ++toastIdCounter;

      setToasts((prev) => {
        const next = [...prev, { id, message, type, action: options.action }];
        // Only keep the most recent MAX_VISIBLE_TOASTS on screen at once
        return next.slice(-MAX_VISIBLE_TOASTS);
      });

      setTimeout(() => removeToast(id), options.duration ?? 4000);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}
