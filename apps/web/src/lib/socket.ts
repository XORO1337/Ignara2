import { io } from "socket.io-client";
import { API_URL } from "./api";

export const locationSocket = io(`${API_URL}/locations`, {
  autoConnect: false,
  path: "/locations/socket.io",
  withCredentials: true,
});
