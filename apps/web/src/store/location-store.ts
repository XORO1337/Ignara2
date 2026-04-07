"use client";

import type { LastKnownLocation } from "@ignara/sharedtypes";
import { create } from "zustand";

type LocationState = {
  locations: Record<string, LastKnownLocation>;
  setLocations: (locations: LastKnownLocation[]) => void;
  upsertLocation: (location: LastKnownLocation) => void;
  removeLocation: (employeeId: string) => void;
};

export const useLocationStore = create<LocationState>((set) => ({
  locations: {},
  setLocations: (locations) =>
    set({
      locations: Object.fromEntries(locations.map((location) => [location.employeeId, location])),
    }),
  upsertLocation: (location) =>
    set((state) => ({
      locations: {
        ...state.locations,
        [location.employeeId]: location,
      },
    })),
  removeLocation: (employeeId) =>
    set((state) => {
      if (!state.locations[employeeId]) {
        return state;
      }

      const next = { ...state.locations };
      delete next[employeeId];
      return { locations: next };
    }),
}));
