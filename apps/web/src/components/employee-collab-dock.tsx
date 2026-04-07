"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMessage,
  LastKnownLocation,
  VoiceInboundSignalPayload,
  VoicePeerEvent,
  VoicePeersPayload,
  VoiceSignal,
} from "@ignara/sharedtypes";
import type { Socket } from "socket.io-client";
import { createChatSocket, createVoiceSocket } from "../lib/socket";
import { useToastStore } from "../store/toast-store";
import { AppButton, AppInput, StatusPill } from "./ui";

type EmployeeCollabDockProps = {
  orgId: string;
  employeeId: string;
  activeRoomId: string | null;
  locationsByEmployee: Record<string, LastKnownLocation>;
};

const MAX_CHAT_MESSAGES = 120;
const PEER_MAX_DISTANCE = 420;

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

export function EmployeeCollabDock({ orgId, employeeId, activeRoomId, locationsByEmployee }: EmployeeCollabDockProps) {
  const addToast = useToastStore((state) => state.addToast);

  const [isOpen, setIsOpen] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const isOpenRef = useRef(isOpen);

  const [chatState, setChatState] = useState<"disconnected" | "connecting" | "connected">("connecting");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");

  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceState, setVoiceState] = useState<"off" | "connecting" | "connected">("off");
  const [voicePeers, setVoicePeers] = useState<string[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const chatSocketRef = useRef<Socket | null>(null);
  const voiceSocketRef = useRef<Socket | null>(null);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const joinedVoiceRoomRef = useRef<string | null>(null);

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
          nextSocket.emit("join", { orgId, employeeId });
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
        socket.disconnect();
      }
      if (chatSocketRef.current === socket) {
        chatSocketRef.current = null;
      }
      setChatState("disconnected");
    };
  }, [addToast, appendChatMessage, employeeId, orgId]);

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

    socket.emit("chat:send", {
      text,
      roomId: activeRoomId ?? undefined,
    });
    setChatInput("");
  }, [activeRoomId, addToast, chatInput]);

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
          setVoiceState("off");
          joinedVoiceRoomRef.current = null;
          setVoicePeers([]);
          closeAllPeerConnections();
        });
        nextSocket.on("voice:error", (message: string) => {
          if (!active) {
            return;
          }
          setVoiceError(message);
          addToast({
            message,
            tone: "warning",
          });
        });
        nextSocket.on("voice:peers", (payload: VoicePeersPayload) => {
          if (!payload || !Array.isArray(payload.peers)) {
            return;
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
      joinedVoiceRoomRef.current = null;
      setVoicePeers([]);
      closeAllPeerConnections();
      stopLocalStream();
      setVoiceState("off");
    };
  }, [
    addToast,
    closeAllPeerConnections,
    closePeerConnection,
    createOfferForPeer,
    employeeId,
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

    const joinedRoomId = joinedVoiceRoomRef.current;
    if (!activeRoomId) {
      if (joinedRoomId) {
        socket.emit("voice:leave");
        joinedVoiceRoomRef.current = null;
        setVoicePeers([]);
        closeAllPeerConnections();
      }
      return;
    }

    if (joinedRoomId === activeRoomId) {
      return;
    }

    if (joinedRoomId) {
      socket.emit("voice:leave");
      setVoicePeers([]);
      closeAllPeerConnections();
    }

    socket.emit("voice:join", {
      orgId,
      employeeId,
      roomId: activeRoomId,
    });
    joinedVoiceRoomRef.current = activeRoomId;
  }, [activeRoomId, closeAllPeerConnections, employeeId, orgId, voiceEnabled, voiceState]);

  useEffect(() => {
    if (!voiceEnabled || voicePeers.length === 0) {
      return;
    }

    const localLocation = locationsByEmployee[employeeId];

    Object.entries(remoteAudioElementsRef.current).forEach(([peerEmployeeId, audio]) => {
      const peerLocation = locationsByEmployee[peerEmployeeId];

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
  }, [employeeId, locationsByEmployee, voiceEnabled, voicePeers]);

  const sortedMessages = useMemo(
    () => [...chatMessages].sort((left, right) => left.ts - right.ts),
    [chatMessages],
  );

  const voiceStatusTone: "neutral" | "success" | "warning" | "error" =
    voiceState === "connected"
      ? "success"
      : voiceState === "connecting"
        ? "warning"
        : voiceEnabled
          ? "warning"
          : "neutral";

  return (
    <div className="pointer-events-none fixed left-2 top-[5.7rem] z-40 flex h-[calc(100vh-6.5rem)] max-h-[48rem] items-start md:left-3">
      <section
        className={`pointer-events-auto relative flex h-full w-[min(23rem,calc(100vw-0.75rem))] flex-col rounded-2xl border border-outline/70 bg-panel/92 shadow-lifted backdrop-blur-md transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-[calc(100%-2.8rem)]"
        }`}
      >
        <button
          type="button"
          className="absolute -right-11 top-3 flex h-11 w-11 items-center justify-center rounded-r-xl border border-outline/70 border-l-0 bg-panel/92 text-xs font-semibold text-text shadow-card transition hover:bg-panel-strong"
          onClick={() => setIsOpen((previous) => !previous)}
          aria-label={isOpen ? "Hide chat" : "Show chat"}
        >
          {isOpen ? "Hide" : "Chat"}
        </button>

        {unreadCount > 0 && !isOpen ? (
          <span className="absolute -right-12 top-14 inline-flex min-w-5 items-center justify-center rounded-full border border-success/35 bg-success/20 px-1.5 py-0.5 text-[10px] font-semibold text-success">
            {unreadCount}
          </span>
        ) : null}

        <header className="border-b border-outline/70 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-data text-xs uppercase tracking-[0.18em] text-text-dim">Team Channel</p>
              <h3 className="mt-1 text-base font-semibold">Employee Chat</h3>
            </div>
            <StatusPill
              tone={chatState === "connected" ? "success" : chatState === "connecting" ? "warning" : "error"}
            >
              {chatState}
            </StatusPill>
          </div>
        </header>

        <div ref={chatBodyRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {sortedMessages.length === 0 ? (
            <p className="rounded-xl border border-outline/65 bg-panel-strong/55 px-3 py-2 text-xs text-text-dim">
              No messages yet. Say hello to your team.
            </p>
          ) : null}

          {sortedMessages.map((message) => {
            const own = message.senderId === employeeId;
            return (
              <article
                key={message.id}
                className={`rounded-xl border px-3 py-2 ${
                  own
                    ? "ml-8 border-accent/40 bg-accent/12 text-text"
                    : "mr-8 border-outline/70 bg-panel-strong/55 text-text"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold">{own ? "You" : employeeHandle(message.senderId)}</p>
                  <p className="text-[10px] text-text-dim">{formatTime(message.ts)}</p>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p>
                {message.roomId ? <p className="mt-1 text-[10px] text-text-dim">Room: {message.roomId}</p> : null}
              </article>
            );
          })}
        </div>

        <footer className="space-y-3 border-t border-outline/70 px-3 py-3">
          <div className="flex items-center gap-2">
            <AppInput
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Type a message"
              maxLength={500}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  sendChatMessage();
                }
              }}
            />
            <AppButton type="button" size="sm" onClick={sendChatMessage} disabled={chatInput.trim().length === 0}>
              Send
            </AppButton>
          </div>

          <div className="rounded-xl border border-outline/70 bg-panel-strong/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-data text-xs uppercase tracking-[0.15em] text-text-dim">Proximity Voice</p>
                <p className="mt-1 text-sm text-text-dim">Room: {activeRoomId ?? "Not in any room"}</p>
              </div>
              <StatusPill tone={voiceStatusTone}>{voiceState}</StatusPill>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <AppButton
                type="button"
                size="sm"
                variant={voiceEnabled ? "secondary" : "primary"}
                onClick={() => {
                  setVoiceError(null);
                  setVoiceEnabled((previous) => !previous);
                }}
              >
                {voiceEnabled ? "Disable Voice" : "Enable Voice"}
              </AppButton>
              <AppButton
                type="button"
                size="sm"
                variant="ghost"
                disabled={!voiceEnabled}
                onClick={() => setVoiceMuted((previous) => !previous)}
              >
                {voiceMuted ? "Unmute Mic" : "Mute Mic"}
              </AppButton>
            </div>

            <p className="mt-2 text-xs text-text-dim">Peers in room: {voicePeers.length}</p>
            {voiceError ? <p className="mt-2 text-xs text-error">{voiceError}</p> : null}
          </div>
        </footer>
      </section>
    </div>
  );
}
