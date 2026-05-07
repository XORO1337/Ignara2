"use client";

import { create } from "zustand";
import type { Role, UserGender } from "@ignara/sharedtypes";
import { apiRequest } from "../lib/api";

export type SessionUser = {
  sub: string;
  email: string;
  role: Role;
  gender: UserGender;
  orgId: string;
  isDevAllowlisted?: boolean;
};

type AuthState = {
  user: SessionUser | null;
  isHydrating: boolean;
  hydrationAttempted: boolean;
  setUser: (user: SessionUser | null) => void;
  hydrateSession: () => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isHydrating: false,
  hydrationAttempted: false,
  setUser: (user) => set({ user }),
  hydrateSession: async () => {
    set((state) => {
      if (state.isHydrating || state.hydrationAttempted) {
        return state;
      }

      return { ...state, isHydrating: true };
    });

    try {
      const response = await apiRequest<{ user: SessionUser }>("/auth/me");
      set({ user: response.user, isHydrating: false, hydrationAttempted: true });
    } catch {
      set({ user: null, isHydrating: false, hydrationAttempted: true });
    }
  },
  logout: async () => {
    try {
      await apiRequest<{ ok: boolean }>("/auth/logout", {
        method: "POST",
      });
    } finally {
      set({ user: null, hydrationAttempted: true });
    }
  },
}));
