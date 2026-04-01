"use client";

import { create } from "zustand";

type SessionUser = {
  sub: string;
  email: string;
  role: "admin" | "manager" | "employee";
  orgId: string;
  isDevAllowlisted?: boolean;
};

type AuthState = {
  user: SessionUser | null;
  setUser: (user: SessionUser | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
