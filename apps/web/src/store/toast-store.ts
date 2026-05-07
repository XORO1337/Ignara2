"use client";

import { create } from "zustand";

export type ToastTone = "neutral" | "success" | "warning" | "error";

export type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
  createdAt: number;
};

type ToastState = {
  toasts: ToastItem[];
  addToast: (input: { message: string; tone?: ToastTone; ttlMs?: number }) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
};

const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: ({ message, tone = "neutral", ttlMs = 4500 }) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = Date.now();

    set((state) => ({
      toasts: [...state.toasts, { id, message: trimmed, tone, createdAt }].slice(-6),
    }));

    const timer = setTimeout(() => {
      get().removeToast(id);
    }, Math.max(1200, ttlMs));
    toastTimers.set(id, timer);
  },
  removeToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }

    set((state) => ({
      toasts: state.toasts.filter((entry) => entry.id !== id),
    }));
  },
  clearToasts: () => {
    toastTimers.forEach((timer) => clearTimeout(timer));
    toastTimers.clear();
    set({ toasts: [] });
  },
}));
