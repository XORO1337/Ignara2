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

export async function createChatSocket(): Promise<Socket> {
  const apiUrl = await getApiUrl();
  return io(`${apiUrl}/chat`, {
    autoConnect: false,
    path: "/chat/socket.io",
    withCredentials: true,
  });
}

export async function createVoiceSocket(): Promise<Socket> {
  const apiUrl = await getApiUrl();
  return io(`${apiUrl}/voice`, {
    autoConnect: false,
    path: "/voice/socket.io",
    withCredentials: true,
  });
}
