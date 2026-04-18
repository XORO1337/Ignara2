import { io, type Socket } from "socket.io-client";
import { getApiUrl } from "./api";

export async function createLocationSocket(): Promise<Socket> {
  const apiUrl = await getApiUrl(true);
  console.info("[socket][locations] creating socket", { apiUrl, path: "/locations/socket.io" });
  return io(`${apiUrl}/locations`, {
    autoConnect: false,
    path: "/locations/socket.io",
    withCredentials: true,
  });
}

export async function createChatSocket(): Promise<Socket> {
  const apiUrl = await getApiUrl(true);
  console.info("[socket][chat] creating socket", { apiUrl, path: "/chat/socket.io" });
  return io(`${apiUrl}/chat`, {
    autoConnect: false,
    path: "/chat/socket.io",
    withCredentials: true,
  });
}

export async function createVoiceSocket(): Promise<Socket> {
  const apiUrl = await getApiUrl(true);
  console.info("[socket][voice] creating socket", { apiUrl, path: "/voice/socket.io" });
  return io(`${apiUrl}/voice`, {
    autoConnect: false,
    path: "/voice/socket.io",
    withCredentials: true,
  });
}
