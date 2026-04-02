import { io, type Socket } from "socket.io-client";
import { getApiUrl } from "./api";

export async function createLocationSocket(): Promise<Socket> {
  const apiUrl = await getApiUrl();
  return io(`${apiUrl}/locations`, {
    autoConnect: false,
    path: "/locations/socket.io",
    withCredentials: true,
  });
}
