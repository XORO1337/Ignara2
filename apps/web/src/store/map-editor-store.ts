"use client";

import type { RoomZone } from "@ignara/sharedtypes";
import { create } from "zustand";
import type { MapBackgroundConfig, MapPropElement } from "../lib/map-config";

type MapEditorState = {
  rooms: RoomZone[];
  props: MapPropElement[];
  background: MapBackgroundConfig | null;
  selectedTarget: { type: "room" | "prop"; id: string } | { type: "background" } | null;
  viewport: { x: number; y: number; scale: number };
  setRooms: (rooms: RoomZone[]) => void;
  setProps: (props: MapPropElement[]) => void;
  setBackground: (background: MapBackgroundConfig | null) => void;
  updateBackground: (patch: Partial<MapBackgroundConfig>) => void;
  addRoom: (room: RoomZone) => void;
  addProp: (prop: MapPropElement) => void;
  updateRoom: (id: string, patch: Partial<RoomZone>) => void;
  updateProp: (id: string, patch: Partial<MapPropElement>) => void;
  removeRoom: (id: string) => void;
  removeProp: (id: string) => void;
  selectTarget: (target: MapEditorState["selectedTarget"]) => void;
  setViewport: (viewport: Partial<MapEditorState["viewport"]>) => void;
  resetEditor: () => void;
};

export const useMapEditorStore = create<MapEditorState>((set) => ({
  rooms: [],
  props: [],
  background: null,
  selectedTarget: null,
  viewport: { x: 0, y: 0, scale: 1 },
  setRooms: (rooms) => set({ rooms }),
  setProps: (props) => set({ props }),
  setBackground: (background) => set({ background }),
  updateBackground: (patch) =>
    set((state) => ({
      background: state.background ? { ...state.background, ...patch } : state.background,
    })),
  addRoom: (room) => set((state) => ({ rooms: [...state.rooms, room] })),
  addProp: (prop) => set((state) => ({ props: [...state.props, prop] })),
  updateRoom: (id, patch) =>
    set((state) => ({
      rooms: state.rooms.map((room) => (room.id === id ? { ...room, ...patch } : room)),
    })),
  updateProp: (id, patch) =>
    set((state) => ({
      props: state.props.map((prop) => (prop.id === id ? { ...prop, ...patch } : prop)),
    })),
  removeRoom: (id) => set((state) => ({ rooms: state.rooms.filter((room) => room.id !== id) })),
  removeProp: (id) => set((state) => ({ props: state.props.filter((prop) => prop.id !== id) })),
  selectTarget: (selectedTarget) => set({ selectedTarget }),
  setViewport: (viewport) =>
    set((state) => ({
      viewport: {
        ...state.viewport,
        ...viewport,
      },
    })),
  resetEditor: () =>
    set({
      rooms: [],
      props: [],
      background: null,
      selectedTarget: null,
      viewport: { x: 0, y: 0, scale: 1 },
    }),
}));
