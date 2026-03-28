"use client";

import type { LastKnownLocation } from "@ignara/sharedtypes";
import { create } from "zustand";

type LocationState = {
  locations: Record<string, LastKnownLocation>;
  setLocations: (locations: LastKnownLocation[]) => void;
  upsertLocation: (location: LastKnownLocation) => void;
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
}));
