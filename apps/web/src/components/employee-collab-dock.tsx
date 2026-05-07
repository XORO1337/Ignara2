"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessage,
  LastKnownLocation,
  ChatJoinPayload,
  VoiceErrorPayload,
  VoiceInboundSignalPayload,
  VoicePeerEvent,
  VoicePeersPayload,
  VoiceSignal,
} from "@ignara/sharedtypes";
import type { Socket } from "socket.io-client";
import { createChatSocket, createVoiceSocket } from "../lib/socket";
import { useToastStore } from "../store/toast-store";
import { alpha } from "@mui/material/styles";
import { Badge, Box, Button, Card, Chip, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { DockedSidePanel } from "./docked-side-panel";

type EmployeeCollabDockProps = {
  orgId: string;
  employeeId: string;
  activeRoomId: string | null;
  locationsByEmployee: Record<string, LastKnownLocation>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

type CollabMode = "global" | "room";

const MAX_CHAT_MESSAGES = 120;
const PEER_MAX_DISTANCE = 420;
const VOICE_JOIN_RETRY_DELAYS_MS = [350, 750, 1400];
const VOICE_ROOM_TRANSITION_DELAY_MS = 120;

function shouldInitiateOffer(localEmployeeId: string, peerEmployeeId: string) {
  return localEmployeeId.localeCompare(peerEmployeeId) < 0;
}

function employeeHandle(employeeId: string) {
  const [handle] = employeeId.split("@");
  return handle || employeeId;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeVoiceError(payload: string | VoiceErrorPayload): VoiceErrorPayload {
  if (typeof payload === "string") {
    return {
      reason: "invalid-payload",
      message: payload,
    };
  }

  return payload;
}

export function EmployeeCollabDock({
  orgId,
  employeeId,
  activeRoomId,
  locationsByEmployee,
  open,
  onOpenChange,
}: EmployeeCollabDockProps) {
  const addToast = useToastStore((state) => state.addToast);

  const [uncontrolledOpen, setUncontrolledOpen] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const isOpenRef = useRef(uncontrolledOpen);

  const isOpen = open ?? uncontrolledOpen;
  const setIsOpen = onOpenChange ?? setUncontrolledOpen;

  const [chatState, setChatState] = useState<"disconnected" | "connecting" | "connected">("connecting");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [collabMode, setCollabMode] = useState<CollabMode>("room");

  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceState, setVoiceState] = useState<"off" | "connecting" | "connected">("off");
  const [voicePeers, setVoicePeers] = useState<string[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const chatSocketRef = useRef<Socket | null>(null);
  const voiceSocketRef = useRef<Socket | null>(null);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const joinedVoiceRoomRef = useRef<string | null>(null);
  const pendingVoiceJoinRoomRef = useRef<string | null>(null);
  const voiceJoinRetryTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const voiceJoinAttemptRef = useRef(0);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const remoteAudioElementsRef = useRef<Record<string, HTMLAudioElement>>({});
  const voiceMutedRef = useRef(voiceMuted);

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (isOpen) {
      setUnreadCount(0);
    }
  }, [isOpen]);

  const clearVoiceJoinRetry = useCallback(() => {
    if (voiceJoinRetryTimerRef.current) {
      clearTimeout(voiceJoinRetryTimerRef.current);
      voiceJoinRetryTimerRef.current = null;
    }
  }, []);

  const roomModeSelected = collabMode === "room";
  const roomChannelAvailable = roomModeSelected && Boolean(activeRoomId);
  const effectiveCollabMode: CollabMode = roomModeSelected ? "room" : "global";

  const emitVoiceJoin = useCallback(
    (mode: CollabMode, roomId?: string | null): boolean => {
      const socket = voiceSocketRef.current;
      if (!socket || !socket.connected) {
        return false;
      }

      if (mode === "room" && !roomId) {
        return false;
      }

      const normalizedMode = mode === "room" ? "room" : "global";
      socket.emit("voice:join", {
        orgId,
        employeeId,
        mode: normalizedMode,
        roomId: normalizedMode === "room" ? roomId : undefined,
      });
      pendingVoiceJoinRoomRef.current = normalizedMode === "room" ? roomId! : "global";
      return true;
    },
    [employeeId, orgId],
  );

  useEffect(() => {
    const node = chatBodyRef.current;
    if (!node) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [chatMessages, isOpen]);

  const appendChatMessage = useCallback(
    (message: ChatMessage) => {
      setChatMessages((previous) => {
        if (previous.some((entry) => entry.id === message.id)) {
          return previous;
        }
        return [...previous, message].slice(-MAX_CHAT_MESSAGES);
      });

      if (message.senderId !== employeeId && !isOpenRef.current) {
        setUnreadCount((previous) => Math.min(99, previous + 1));
      }
    },
    [employeeId],
  );

  const buildChatJoinPayload = useCallback((): ChatJoinPayload => {
    if (collabMode === "room") {
      return {
        orgId,
        employeeId,
        mode: "room",
        roomId: activeRoomId ?? undefined,
      };
    }

    return {
      orgId,
      employeeId,
      mode: "global",
    };
  }, [activeRoomId, collabMode, employeeId, orgId]);

  const syncChatChannel = useCallback(() => {
    const socket = chatSocketRef.current;
    if (!socket || !socket.connected) {
      return;
    }
    socket.emit("join", buildChatJoinPayload());
  }, [buildChatJoinPayload]);

  useEffect(() => {
    let active = true;
    let socket: Socket | null = null;

    const connectChat = async () => {
      try {
        setChatState("connecting");
        const nextSocket = await createChatSocket();
        if (!active) {
          nextSocket.disconnect();
          return;
        }

        socket = nextSocket;
        chatSocketRef.current = nextSocket;

        nextSocket.on("connect", () => {
          setChatState("connected");
          nextSocket.emit("join", buildChatJoinPayload());
        });
        nextSocket.on("disconnect", () => {
          setChatState("disconnected");
        });
        nextSocket.on("chat:history", (history: ChatMessage[]) => {
          if (!active || !Array.isArray(history)) {
            return;
          }

          const normalized = history
            .filter((entry) => entry && typeof entry.id === "string" && typeof entry.text === "string")
            .slice(-MAX_CHAT_MESSAGES);
          setChatMessages(normalized);
        });
        nextSocket.on("chat:message", (message: ChatMessage) => {
          if (!active || !message || typeof message.id !== "string") {
            return;
          }
          appendChatMessage(message);
        });
        nextSocket.on("chat:error", (message: string) => {
          if (!active) {
            return;
          }
          addToast({
            message: typeof message === "string" && message.trim().length > 0 ? message : "Chat channel update failed.",
            tone: "warning",
          });
        });
        nextSocket.connect();
      } catch (error) {
        if (!active) {
          return;
        }
        setChatState("disconnected");
        addToast({
          message: `Chat connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          tone: "error",
        });
      }
    };

    void connectChat();

    return () => {
      active = false;
      if (socket) {
        socket.off("connect");
        socket.off("disconnect");
        socket.off("chat:history");
        socket.off("chat:message");
        socket.off("chat:error");
        socket.disconnect();
      }
      if (chatSocketRef.current === socket) {
        chatSocketRef.current = null;
      }
      setChatState("disconnected");
    };
  }, [addToast, appendChatMessage, buildChatJoinPayload]);

  useEffect(() => {
    syncChatChannel();
  }, [syncChatChannel]);

  const sendChatMessage = useCallback(() => {
    const text = chatInput.trim();
    if (!text) {
      return;
    }

    const socket = chatSocketRef.current;
    if (!socket || !socket.connected) {
      addToast({
        message: "Chat is reconnecting. Message was not sent.",
        tone: "warning",
      });
      return;
    }

    if (roomModeSelected && !activeRoomId) {
      addToast({
        message: "ROOM channel is unavailable until your marker is inside a mapped room.",
        tone: "warning",
      });
      return;
    }

    socket.emit("chat:send", {
      text,
      mode: effectiveCollabMode,
      roomId: effectiveCollabMode === "room" ? activeRoomId ?? undefined : undefined,
    });
    setChatInput("");
  }, [activeRoomId, addToast, chatInput, effectiveCollabMode, roomModeSelected]);

  const removeRemoteAudioElement = useCallback((peerEmployeeId: string) => {
    const audio = remoteAudioElementsRef.current[peerEmployeeId];
    if (!audio) {
      return;
    }

    audio.pause();
    audio.srcObject = null;
    audio.remove();
    delete remoteAudioElementsRef.current[peerEmployeeId];
  }, []);

  const closePeerConnection = useCallback(
    (peerEmployeeId: string) => {
      const connection = peerConnectionsRef.current[peerEmployeeId];
      if (connection) {
        connection.ontrack = null;
        connection.onicecandidate = null;
        connection.close();
        delete peerConnectionsRef.current[peerEmployeeId];
      }

      removeRemoteAudioElement(peerEmployeeId);
    },
    [removeRemoteAudioElement],
  );

  const closeAllPeerConnections = useCallback(() => {
    Object.keys(peerConnectionsRef.current).forEach((peerEmployeeId) => {
      closePeerConnection(peerEmployeeId);
    });
  }, [closePeerConnection]);

  const stopLocalStream = useCallback(() => {
    if (!localStreamRef.current) {
      return;
    }

    localStreamRef.current.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }, []);

  const ensureRemoteAudioElement = useCallback((peerEmployeeId: string) => {
    const existing = remoteAudioElementsRef.current[peerEmployeeId];
    if (existing) {
      return existing;
    }

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    audio.dataset.peerEmployeeId = peerEmployeeId;
    audio.style.display = "none";
    document.body.appendChild(audio);
    remoteAudioElementsRef.current[peerEmployeeId] = audio;
    return audio;
  }, []);

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support microphone access.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    stream.getAudioTracks().forEach((track) => {
      track.enabled = !voiceMutedRef.current;
    });

    localStreamRef.current = stream;
    return stream;
  }, []);

  const sendVoiceSignal = useCallback((to: string, signal: VoiceSignal) => {
    const socket = voiceSocketRef.current;
    if (!socket || !socket.connected) {
      return;
    }

    socket.emit("voice:signal", { to, signal });
  }, []);

  const ensurePeerConnection = useCallback(
    async (peerEmployeeId: string) => {
      const existing = peerConnectionsRef.current[peerEmployeeId];
      if (existing) {
        return existing;
      }

      if (typeof RTCPeerConnection === "undefined") {
        throw new Error("WebRTC is not supported in this browser.");
      }

      const stream = await ensureLocalStream();
      const connection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      stream.getTracks().forEach((track) => {
        connection.addTrack(track, stream);
      });

      connection.onicecandidate = (event) => {
        const candidate = event.candidate;
        if (!candidate) {
          return;
        }

        sendVoiceSignal(peerEmployeeId, {
          type: "ice-candidate",
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? undefined,
          sdpMLineIndex: typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : undefined,
        });
      };

      connection.ontrack = (event) => {
        const [streamEntry] = event.streams;
        if (!streamEntry) {
          return;
        }

        const audio = ensureRemoteAudioElement(peerEmployeeId);
        if (audio.srcObject !== streamEntry) {
          audio.srcObject = streamEntry;
        }
        void audio.play().catch(() => {
          // Browser autoplay rules can block immediate playback until user interaction.
        });
      };

      peerConnectionsRef.current[peerEmployeeId] = connection;
      return connection;
    },
    [ensureLocalStream, ensureRemoteAudioElement, sendVoiceSignal],
  );

  const createOfferForPeer = useCallback(
    async (peerEmployeeId: string) => {
      try {
        const connection = await ensurePeerConnection(peerEmployeeId);
        if (connection.signalingState !== "stable") {
          return;
        }

        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);

        if (offer.sdp) {
          sendVoiceSignal(peerEmployeeId, {
            type: "offer",
            sdp: offer.sdp,
          });
        }
      } catch (error) {
        addToast({
          message: `Voice offer failed for ${employeeHandle(peerEmployeeId)}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          tone: "warning",
        });
      }
    },
    [addToast, ensurePeerConnection, sendVoiceSignal],
  );

  const handleInboundSignal = useCallback(
    async (fromEmployeeId: string, signal: VoiceSignal) => {
      try {
        const connection = await ensurePeerConnection(fromEmployeeId);

        if (signal.type === "offer") {
          if (connection.signalingState !== "stable") {
            try {
              await connection.setLocalDescription({ type: "rollback" });
            } catch {
              // Ignore rollback failures and continue attempting to apply offer.
            }
          }

          await connection.setRemoteDescription(
            new RTCSessionDescription({
              type: "offer",
              sdp: signal.sdp,
            }),
          );

          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          if (answer.sdp) {
            sendVoiceSignal(fromEmployeeId, {
              type: "answer",
              sdp: answer.sdp,
            });
          }
          return;
        }

        if (signal.type === "answer") {
          if (connection.signalingState === "have-local-offer") {
            await connection.setRemoteDescription(
              new RTCSessionDescription({
                type: "answer",
                sdp: signal.sdp,
              }),
            );
          }
          return;
        }

        if (!signal.candidate) {
          return;
        }

        await connection.addIceCandidate(
          new RTCIceCandidate({
            candidate: signal.candidate,
            sdpMid: signal.sdpMid,
            sdpMLineIndex: signal.sdpMLineIndex,
          }),
        );
      } catch {
        // Network race conditions can surface when peers join/leave quickly.
      }
    },
    [ensurePeerConnection, sendVoiceSignal],
  );

  useEffect(() => {
    voiceMutedRef.current = voiceMuted;
    if (!localStreamRef.current) {
      return;
    }

    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !voiceMuted;
    });
  }, [voiceMuted]);

  useEffect(() => {
    if (!voiceEnabled) {
      setVoiceState("off");
      setVoiceError(null);
      setVoicePeers([]);
      clearVoiceJoinRetry();
      voiceJoinAttemptRef.current = 0;
      pendingVoiceJoinRoomRef.current = null;

      const existingSocket = voiceSocketRef.current;
      if (existingSocket) {
        existingSocket.emit("voice:leave");
        existingSocket.disconnect();
        voiceSocketRef.current = null;
      }

      joinedVoiceRoomRef.current = null;
      closeAllPeerConnections();
      stopLocalStream();
      return;
    }

    if (typeof RTCPeerConnection === "undefined") {
      setVoiceError("Your browser does not support WebRTC voice calls.");
      setVoiceEnabled(false);
      return;
    }

    let active = true;
    let socket: Socket | null = null;

    const connectVoice = async () => {
      try {
        setVoiceState("connecting");
        setVoiceError(null);

        await ensureLocalStream();
        const nextSocket = await createVoiceSocket();
        if (!active) {
          nextSocket.disconnect();
          return;
        }

        socket = nextSocket;
        voiceSocketRef.current = nextSocket;

        nextSocket.on("connect", () => {
          setVoiceState("connected");
        });
        nextSocket.on("disconnect", () => {
          clearVoiceJoinRetry();
          voiceJoinAttemptRef.current = 0;
          pendingVoiceJoinRoomRef.current = null;
          setVoiceState("off");
          joinedVoiceRoomRef.current = null;
          setVoicePeers([]);
          closeAllPeerConnections();
        });
        nextSocket.on("voice:error", (rawPayload: VoiceErrorPayload | string) => {
          if (!active) {
            return;
          }

          const payload = normalizeVoiceError(rawPayload);
          const pendingRoomId = pendingVoiceJoinRoomRef.current;
          const maxVoiceJoinAttempts = VOICE_JOIN_RETRY_DELAYS_MS.length;
          const canRetryJoin =
            payload.reason === "not-connected" &&
            typeof pendingRoomId === "string" &&
            pendingRoomId.length > 0 &&
            voiceJoinAttemptRef.current < maxVoiceJoinAttempts &&
            voiceSocketRef.current?.connected;

          if (canRetryJoin) {
            voiceJoinAttemptRef.current += 1;
            const attempt = voiceJoinAttemptRef.current;
            const retryDelay = VOICE_JOIN_RETRY_DELAYS_MS[attempt - 1] ?? VOICE_JOIN_RETRY_DELAYS_MS[maxVoiceJoinAttempts - 1];
            setVoiceError(`Reconnecting voice (${attempt}/${maxVoiceJoinAttempts})...`);
            clearVoiceJoinRetry();

            voiceJoinRetryTimerRef.current = setTimeout(() => {
              if (!active || voiceSocketRef.current !== nextSocket || !voiceSocketRef.current?.connected) {
                return;
              }

              if (!pendingVoiceJoinRoomRef.current || pendingVoiceJoinRoomRef.current !== pendingRoomId) {
                return;
              }

              emitVoiceJoin(pendingRoomId === "global" ? "global" : "room", pendingRoomId === "global" ? undefined : pendingRoomId);
            }, retryDelay);
            return;
          }

          clearVoiceJoinRetry();
          voiceJoinAttemptRef.current = 0;
          pendingVoiceJoinRoomRef.current = null;
          joinedVoiceRoomRef.current = null;
          setVoicePeers([]);
          addToast({
            message: payload.message,
            tone: "warning",
          });
          setVoiceError(payload.message);
        });
        nextSocket.on("voice:peers", (payload: VoicePeersPayload) => {
          if (!payload || !Array.isArray(payload.peers)) {
            return;
          }

          if (pendingVoiceJoinRoomRef.current) {
            joinedVoiceRoomRef.current = pendingVoiceJoinRoomRef.current;
            pendingVoiceJoinRoomRef.current = null;
            voiceJoinAttemptRef.current = 0;
            clearVoiceJoinRetry();
            setVoiceError(null);
          }

          const peers = payload.peers.filter((entry) => typeof entry === "string" && entry !== employeeId);
          setVoicePeers([...new Set(peers)]);

          peers.forEach((peerEmployeeId) => {
            if (shouldInitiateOffer(employeeId, peerEmployeeId)) {
              void createOfferForPeer(peerEmployeeId);
            } else {
              void ensurePeerConnection(peerEmployeeId);
            }
          });
        });
        nextSocket.on("voice:peer-joined", (payload: VoicePeerEvent) => {
          const peerEmployeeId = payload?.employeeId?.trim();
          if (!peerEmployeeId || peerEmployeeId === employeeId) {
            return;
          }

          setVoicePeers((previous) => (previous.includes(peerEmployeeId) ? previous : [...previous, peerEmployeeId]));

          if (shouldInitiateOffer(employeeId, peerEmployeeId)) {
            void createOfferForPeer(peerEmployeeId);
          } else {
            void ensurePeerConnection(peerEmployeeId);
          }
        });
        nextSocket.on("voice:peer-left", (payload: VoicePeerEvent) => {
          const peerEmployeeId = payload?.employeeId?.trim();
          if (!peerEmployeeId) {
            return;
          }

          closePeerConnection(peerEmployeeId);
          setVoicePeers((previous) => previous.filter((entry) => entry !== peerEmployeeId));
        });
        nextSocket.on("voice:signal", (payload: VoiceInboundSignalPayload) => {
          if (!payload?.from || !payload?.signal) {
            return;
          }

          const fromEmployeeId = payload.from.trim();
          if (!fromEmployeeId || fromEmployeeId === employeeId) {
            return;
          }

          void handleInboundSignal(fromEmployeeId, payload.signal);
        });

        nextSocket.connect();
      } catch (error) {
        if (!active) {
          return;
        }
        clearVoiceJoinRetry();
        voiceJoinAttemptRef.current = 0;
        pendingVoiceJoinRoomRef.current = null;
        joinedVoiceRoomRef.current = null;
        const message =
          error instanceof Error ? error.message : "Unable to access microphone for proximity voice.";
        setVoiceError(message);
        setVoiceState("off");
        setVoiceEnabled(false);
        addToast({
          message,
          tone: "error",
        });
        stopLocalStream();
      }
    };

    void connectVoice();

    return () => {
      active = false;
      if (socket) {
        socket.off("connect");
        socket.off("disconnect");
        socket.off("voice:error");
        socket.off("voice:peers");
        socket.off("voice:peer-joined");
        socket.off("voice:peer-left");
        socket.off("voice:signal");
        socket.disconnect();
      }
      if (voiceSocketRef.current === socket) {
        voiceSocketRef.current = null;
      }
      clearVoiceJoinRetry();
      voiceJoinAttemptRef.current = 0;
      pendingVoiceJoinRoomRef.current = null;
      joinedVoiceRoomRef.current = null;
      setVoicePeers([]);
      closeAllPeerConnections();
      stopLocalStream();
      setVoiceState("off");
    };
  }, [
    addToast,
    clearVoiceJoinRetry,
    closeAllPeerConnections,
    closePeerConnection,
    createOfferForPeer,
    employeeId,
    emitVoiceJoin,
    ensureLocalStream,
    ensurePeerConnection,
    handleInboundSignal,
    stopLocalStream,
    voiceEnabled,
  ]);

  useEffect(() => {
    if (!voiceEnabled || voiceState !== "connected") {
      return;
    }

    const socket = voiceSocketRef.current;
    if (!socket || !socket.connected) {
      return;
    }

    const targetRoomId = roomModeSelected ? activeRoomId : "global";
    const joinedRoomId = joinedVoiceRoomRef.current;
    const pendingRoomId = pendingVoiceJoinRoomRef.current;
    if (!targetRoomId) {
      if (joinedRoomId || pendingRoomId) {
        socket.emit("voice:leave");
        clearVoiceJoinRetry();
        voiceJoinAttemptRef.current = 0;
        pendingVoiceJoinRoomRef.current = null;
        joinedVoiceRoomRef.current = null;
        setVoicePeers([]);
        closeAllPeerConnections();
      }
      return;
    }

    if (joinedRoomId === targetRoomId && !pendingRoomId) {
      return;
    }

    if (pendingRoomId === targetRoomId) {
      return;
    }

    if (joinedRoomId) {
      socket.emit("voice:leave");
      setVoicePeers([]);
      closeAllPeerConnections();
      joinedVoiceRoomRef.current = null;
    }

    clearVoiceJoinRetry();
    voiceJoinAttemptRef.current = 0;
    pendingVoiceJoinRoomRef.current = targetRoomId;
    setVoiceError(null);

    if (joinedRoomId) {
      voiceJoinRetryTimerRef.current = setTimeout(() => {
        if (!voiceSocketRef.current?.connected) {
          return;
        }

        if (pendingVoiceJoinRoomRef.current !== targetRoomId) {
          return;
        }

        emitVoiceJoin(targetRoomId === "global" ? "global" : "room", targetRoomId === "global" ? undefined : targetRoomId);
      }, VOICE_ROOM_TRANSITION_DELAY_MS);
      return;
    }

    emitVoiceJoin(targetRoomId === "global" ? "global" : "room", targetRoomId === "global" ? undefined : targetRoomId);
  }, [
    activeRoomId,
    clearVoiceJoinRetry,
    closeAllPeerConnections,
    emitVoiceJoin,
    roomModeSelected,
    voiceEnabled,
    voiceState,
  ]);

  useEffect(() => {
    if (!voiceEnabled || voicePeers.length === 0) {
      return;
    }

    const localLocation = locationsByEmployee[employeeId];

    Object.entries(remoteAudioElementsRef.current).forEach(([peerEmployeeId, audio]) => {
      const peerLocation = locationsByEmployee[peerEmployeeId];

      if (collabMode === "global") {
        audio.volume = 1;
        return;
      }

      if (
        !localLocation ||
        !localLocation.connected ||
        !peerLocation ||
        !peerLocation.connected ||
        localLocation.roomId !== peerLocation.roomId ||
        typeof localLocation.x !== "number" ||
        typeof localLocation.y !== "number" ||
        typeof peerLocation.x !== "number" ||
        typeof peerLocation.y !== "number"
      ) {
        audio.volume = 0;
        return;
      }

      const distance = Math.hypot(peerLocation.x - localLocation.x, peerLocation.y - localLocation.y);
      const normalized = clamp(1 - distance / PEER_MAX_DISTANCE, 0, 1);
      audio.volume = clamp(normalized * normalized, 0.05, 1);
    });
  }, [collabMode, employeeId, locationsByEmployee, voiceEnabled, voicePeers]);

  const sortedMessages = useMemo(
    () => [...chatMessages].sort((left, right) => left.ts - right.ts),
    [chatMessages],
  );

  const voiceStatusTone: "default" | "success" | "warning" | "error" =
    voiceState === "connected"
      ? "success"
      : voiceState === "connecting"
        ? "warning"
        : voiceEnabled
          ? "warning"
          : "default";
  const activeChannelLabel = roomModeSelected
    ? activeRoomId
      ? `ROOM (${activeRoomId})`
      : "ROOM (UNAVAILABLE)"
    : "GLOBAL";

  return (
    <DockedSidePanel
      side="right"
      open={isOpen}
      topOffset={16}
      bottomOffset={16}
      rail={
        <Badge color="success" badgeContent={unreadCount} invisible={unreadCount === 0}>
          <Button
            variant="contained"
            size="small"
            onClick={() => setIsOpen(true)}
            aria-label="Show chat"
            sx={{
              borderRadius: 999,
              minWidth: 44,
              minHeight: 44,
              width: 44,
              height: 44,
              p: 0,
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              boxShadow: 3,
            }}
          >
            Open Chat
          </Button>
        </Badge>
      }
    >
        <Box sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Stack spacing={1.25}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.6, fontWeight: 700 }}>
                  Team Channel
                </Typography>
                <Typography variant="h6">Employee Chat + Voice</Typography>
              </Box>
              <Chip
                size="small"
                color={chatState === "connected" ? "success" : chatState === "connecting" ? "warning" : "error"}
                label={chatState}
              />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button size="small" variant="outlined" onClick={() => setIsOpen(false)}>
                Hide Chat
              </Button>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                CHANNEL MODE
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 800 }}>
                {activeChannelLabel}
              </Typography>
            </Box>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={collabMode}
              onChange={(_event, value: CollabMode | null) => {
                if (!value) {
                  return;
                }
                setCollabMode(value);
              }}
              aria-label="GLOBAL / ROOM"
              fullWidth
            >
              <ToggleButton value="global">GLOBAL</ToggleButton>
              <ToggleButton value="room">ROOM</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Box>

        <Box
          ref={chatBodyRef}
          sx={{
            flexGrow: 1,
            overflowY: 'auto',
            px: 2.5,
            py: 2,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          {sortedMessages.length === 0 ? (
            <Card elevation={0} sx={{ p: 2 }}>
              <Typography variant="caption" color="text.secondary">
                No messages yet. Say hello to your team.
              </Typography>
            </Card>
          ) : null}

          {sortedMessages.map((message) => {
            const own = message.senderId === employeeId;
            return (
              <Box
                key={message.id}
                sx={(theme) => ({
                  ml: own ? 5 : 0,
                  mr: own ? 0 : 5,
                  p: 1.5,
                  borderRadius: 2.5,
                  border: '1px solid',
                  borderColor: own ? alpha(theme.palette.primary.main, 0.4) : theme.palette.divider,
                  bgcolor: own ? alpha(theme.palette.primary.main, 0.12) : theme.palette.background.default,
                })}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="caption" fontWeight={600} noWrap>
                    {own ? "You" : employeeHandle(message.senderId)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatTime(message.ts)}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                  {message.text}
                </Typography>
              </Box>
            );
          })}

        </Box>

        <Box sx={{ px: 2.5, py: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1.5, flexShrink: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              fullWidth
              size="small"
              multiline
              minRows={1}
              value={chatInput}
              placeholder="Type a message"
              inputProps={{ maxLength: 500 }}
              sx={{
                '& .MuiInputBase-root': {
                  minHeight: 44,
                  alignItems: 'flex-start',
                },
              }}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  sendChatMessage();
                }
              }}
            />
            <Button
              variant="contained"
              size="small"
              onClick={sendChatMessage}
              disabled={chatInput.trim().length === 0 || (roomModeSelected && !roomChannelAvailable)}
            >
              Send
            </Button>
          </Stack>
          {roomModeSelected && !roomChannelAvailable ? (
            <Typography variant="caption" color="warning.main">
              ROOM mode is selected but your marker is not currently inside a mapped room.
            </Typography>
          ) : null}

          <Card elevation={0} sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                  <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1.4, fontWeight: 700 }}>
                    Voice Channel
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Mode: {activeChannelLabel}
                  </Typography>
                </Box>
                <Chip size="small" color={voiceStatusTone} label={voiceState} />
              </Box>

              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Button
                  variant={voiceEnabled ? "outlined" : "contained"}
                  size="small"
                  disabled={roomModeSelected && !roomChannelAvailable}
                  onClick={() => {
                    setVoiceError(null);
                    setVoiceEnabled((previous) => !previous);
                  }}
                >
                  {voiceEnabled ? "Disable Voice" : "Enable Voice"}
                </Button>
                <Button
                  variant="text"
                  size="small"
                  disabled={!voiceEnabled}
                  onClick={() => setVoiceMuted((previous) => !previous)}
                >
                  {voiceMuted ? "Unmute Mic" : "Mute Mic"}
                </Button>
              </Stack>

              <Typography variant="caption" color="text.secondary">
                Peers in channel: {voicePeers.length}
              </Typography>
              {voiceError ? (
                <Typography variant="caption" color="error.main">
                  {voiceError}
                </Typography>
              ) : null}
            </Stack>
          </Card>
        </Box>
    </DockedSidePanel>
  );
}
