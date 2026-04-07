"use client";

import { useMemo } from "react";
import { useToastStore } from "../store/toast-store";

function toneClasses(tone: "neutral" | "success" | "warning" | "error") {
  if (tone === "success") {
    return "border-success/35 bg-success/15 text-success";
  }
  if (tone === "warning") {
    return "border-warning/35 bg-warning/15 text-warning";
  }
  if (tone === "error") {
    return "border-error/35 bg-error/15 text-error";
  }
  return "border-outline/75 bg-panel/95 text-text";
}

export function ToastFeed() {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  const orderedToasts = useMemo(
    () => [...toasts].sort((left, right) => left.createdAt - right.createdAt),
    [toasts],
  );

  if (orderedToasts.length === 0) {
    return null;
  }

  return (
    <aside className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2">
      {orderedToasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => removeToast(toast.id)}
          className={`pointer-events-auto rounded-xl border px-3 py-2 text-left text-sm shadow-glass backdrop-blur-sm transition hover:translate-x-0.5 ${toneClasses(toast.tone)}`}
          aria-label="Dismiss notification"
        >
          {toast.message}
        </button>
      ))}
    </aside>
  );
}
