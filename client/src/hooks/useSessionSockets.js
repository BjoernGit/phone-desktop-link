import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { ensureDesktopSessionId, getSessionIdFromUrl } from "../utils/session";
import { encryptJsonWithSecret, generateSeedBase64Url } from "../utils/crypto";

// Set to true for verbose socket debugging
const DEBUG_SOCKETS = false;

function getClientUuid() {
  const key = "snap2desk-client-id";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const uuid = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(key, uuid);
    return uuid;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

function getSocketUrl() {
  return window.location.origin;
}

export function useSessionSockets({ isMobile, deviceName, onDecryptPhoto, onSessionOffer, onPeerStatus, onPeerFileList }) {
  const [sessionId, setSessionId] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [peers, setPeers] = useState([]);
  const [photos, setPhotos] = useState([]);
  const joinedSessionRef = useRef("");
  const clientUuid = useMemo(() => getClientUuid(), []);

  // Use refs for callbacks to avoid re-registering event listeners
  const onDecryptPhotoRef = useRef(onDecryptPhoto);
  const onSessionOfferRef = useRef(onSessionOffer);
  const onPeerStatusRef = useRef(onPeerStatus);
  const onPeerFileListRef = useRef(onPeerFileList);

  useEffect(() => {
    onDecryptPhotoRef.current = onDecryptPhoto;
    onSessionOfferRef.current = onSessionOffer;
    onPeerStatusRef.current = onPeerStatus;
    onPeerFileListRef.current = onPeerFileList;
  });

  const socket = useMemo(() => {
    const isSecure = window.location.protocol === "https:";
    const url = getSocketUrl();
    const s = io(url, {
      path: "/socket.io",
      // Nur Polling, Upgrade aus -> stabil bei HTTPS/Proxy
      transports: ["polling"],
      upgrade: false,
      autoConnect: false,
      secure: isSecure,
      // Keine Cookies/withCredentials nötig; verhindert CORS-Probleme über den Tunnel
      withCredentials: false,
    });

    s.on("connect_error", (err) => {
      const msg = err?.message || err || "connect_error";
      console.warn("Socket connect_error", msg);
      setSocketStatus(`connect_error: ${msg}`);
    });

    s.on("error", (err) => {
      const msg = err?.message || err || "error";
      console.warn("Socket error", msg);
      setSocketStatus(`error: ${msg}`);
    });

    s.on("reconnect_attempt", () => setSocketStatus("reconnect_attempt"));
    s.on("reconnect_failed", () => setSocketStatus("reconnect_failed"));

    return s;
  }, []);

  // determine session id based on role
  useEffect(() => {
    // Both mobile and desktop generate session ID if none exists
    const sid = isMobile ? (getSessionIdFromUrl() ?? ensureDesktopSessionId()) : ensureDesktopSessionId();
    if (DEBUG_SOCKETS) console.log("setSessionId derived", { sid, isMobile, fromUrl: window.location.search });
    if (!sid || sid === sessionId) return;
    // Sync state to external source (URL/session generator)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionId(sid);
  }, [isMobile, sessionId]);

  const emitJoin = useCallback(
    (reason = "auto") => {
      if (!sessionId) return;
      if (!socket.connected) return;
      const role = isMobile ? "mobile" : "desktop";
      if (DEBUG_SOCKETS) console.log("emit join-session", { sessionId, role, deviceName, clientUuid, reason, socketId: socket.id });
      socket.emit("join-session", { sessionId, role, deviceName, clientUuid });
      joinedSessionRef.current = sessionId;
    },
    [clientUuid, deviceName, isMobile, sessionId, socket]
  );

  // ensure socket connects once wir eine SessionId haben
  useEffect(() => {
    if (!sessionId) return;
    if (!socket.connected) {
      try {
        socket.connect();
      } catch (e) {
        console.warn("socket connect failed", e);
      }
    }
  }, [sessionId, socket]);

  // Timeout-Fallback, damit "connecting" nicht endlos stehenbleibt
  useEffect(() => {
    if (socketConnected) return undefined;
    const shouldTimeout = socketStatus === "connecting" || socketStatus === "reconnect_attempt";
    if (!shouldTimeout) return undefined;
    const timer = setTimeout(() => {
      if (!socketConnected) setSocketStatus("connect_timeout");
    }, 8000);
    return () => clearTimeout(timer);
  }, [socketConnected, socketStatus]);

  // connect/disconnect bookkeeping
  useEffect(() => {
    const onConnect = () => {
      if (DEBUG_SOCKETS) console.log("socket connected (client)", { socketId: socket.id });
      setSocketConnected(true);
      setSocketStatus("connected");
      emitJoin("connect");
    };
    const onDisconnect = (reason) => {
      setSocketConnected(false);
      setPeers([]);
      joinedSessionRef.current = "";
      setSocketStatus(`disconnected${reason ? `: ${reason}` : ""}`);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    // Falls der Socket schon verbunden ist, setze den Status direkt
    if (socket.connected) {
      onConnect();
    }
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [emitJoin, socket]);

  // join session + peer/photo events
  useEffect(() => {
    if (!sessionId) return undefined;
    const role = isMobile ? "mobile" : "desktop";
    if (DEBUG_SOCKETS) console.log("socket effect (events) for session", sessionId, "role", role, "connected?", socketConnected);

    const onPeerJoined = ({ role: joinedRole, clientId, deviceName: joinedName, clientUuid: peerUuid }) => {
      if (DEBUG_SOCKETS) console.log("peer-joined event", { joinedRole, clientId, joinedName, peerUuid });
      setPeers((prev) => {
        // Don't add ourselves
        if (peerUuid === clientUuid) return prev;
        // Check for duplicates by clientUuid (stable ID) or clientId (socket ID)
        if (prev.some((p) => p.clientUuid === peerUuid || p.id === clientId)) {
          // Update existing peer's clientId if uuid matches (reconnect case)
          return prev.map((p) =>
            p.clientUuid === peerUuid
              ? { ...p, id: clientId, role: joinedRole, name: joinedName || "Geraet" }
              : p
          );
        }
        return [...prev, { id: clientId, role: joinedRole, name: joinedName || "Geraet", clientUuid: peerUuid }];
      });
    };

    const onPeerLeft = ({ clientId }) => {
      setPeers((prev) => prev.filter((p) => p.id !== clientId));
    };

    const onPhoto = async (payload) => {
      const currentOnDecryptPhoto = onDecryptPhotoRef.current;
      if (payload?.ciphertext && currentOnDecryptPhoto) {
        try {
          const decrypted = await currentOnDecryptPhoto(payload);
          if (decrypted) {
            setPhotos((prev) => [decrypted, ...prev]);
          }
          return;
        } catch (e) {
          console.warn("Decrypt failed", e);
        }
      }
      // Plaine Payloads werden bewusst ignoriert, um Klartext zu verhindern
    };

    socket.on("peer-joined", onPeerJoined);
    socket.on("peer-left", onPeerLeft);
    socket.on("photo", onPhoto);
    socket.on("session-offer", (payload) => {
      if (DEBUG_SOCKETS) console.log("session-offer received", payload);
      onSessionOfferRef.current?.(payload);
    });
    socket.on("peer-status", (payload) => {
      onPeerStatusRef.current?.(payload);
    });
    socket.on("peer-file-list", (payload) => {
      if (DEBUG_SOCKETS) console.log("[useSessionSockets] peer-file-list received", payload);
      onPeerFileListRef.current?.(payload);
    });

    return () => {
      socket.off("peer-joined", onPeerJoined);
      socket.off("peer-left", onPeerLeft);
      socket.off("photo", onPhoto);
      socket.off("session-offer");
      socket.off("peer-status");
      socket.off("peer-file-list");
    };
  }, [clientUuid, isMobile, sessionId, socket, socketConnected]);

  // emit join when sessionId changes and Socket ist verbunden
  useEffect(() => {
    if (!sessionId || !socketConnected) return;
    if (joinedSessionRef.current === sessionId) return;
    emitJoin("session-change");
  }, [emitJoin, sessionId, socketConnected]);

  const forceJoin = useCallback(() => {
    if (!sessionId) return;
    if (!socket.connected) {
      try {
        socket.connect();
      } catch (e) {
        console.warn("socket connect failed", e);
      }
    }
    emitJoin("force");
  }, [emitJoin, sessionId, socket]);

  // Optional: manueller Join-Trigger (für Notfälle)
  useEffect(() => {
    const handler = () => {
      forceJoin();
    };
    window.addEventListener("manual-join", handler);
    return () => window.removeEventListener("manual-join", handler);
  }, [forceJoin]);

  // Emit leave-session before unload/unmount
  useEffect(() => {
    const leaveSession = () => {
      if (sessionId && socket.connected) {
        socket.emit("leave-session", { sessionId, clientUuid });
      }
    };

    // Handle page unload (close tab, refresh, navigate away)
    const handleBeforeUnload = () => {
      leaveSession();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    // Handle component unmount
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      leaveSession();
      socket.close();
    };
  }, [sessionId, socket, clientUuid]);

  const sendPhoto = useCallback(
    (payload) => {
      if (!sessionId || !payload) return;
      socket.emit("photo", { sessionId, ...payload });
    },
    [sessionId, socket]
  );

  const sendSessionOffer = useCallback(
    async (offer, targetSessionId, targetUuid, targetOfferSecret) => {
      if (!sessionId || !offer) return;
      if (!offer.session || !offer.seed || !targetOfferSecret) {
        console.warn("sendSessionOffer missing data");
        return;
      }
      const nonce = generateSeedBase64Url(12);
      const ts = Date.now();
      let enc;
      try {
        enc = await encryptJsonWithSecret(
          targetOfferSecret,
          { session: offer.session, seed: offer.seed, offerSecret: offer.offerSecret },
          "offer-share"
        );
      } catch (e) {
        console.warn("offer encrypt failed", e);
        return;
      }
      const enrichedOffer = { enc, nonce, ts };
      if (DEBUG_SOCKETS) console.log("send session-offer", { from: sessionId, target: targetSessionId, targetUuid, offer: enrichedOffer });
      socket.emit("session-offer", { sessionId, offer: enrichedOffer, target: targetSessionId, targetUuid });
    },
    [sessionId, socket]
  );

  const sendPeerDecision = useCallback(
    (targetUuid, decision) => {
      if (!sessionId || !targetUuid || !decision) return;
      socket.emit("peer-decision", { targetUuid, decision });
    },
    [sessionId, socket]
  );

  const addLocalPhoto = useCallback((src) => {
    if (!src) return;
    setPhotos((prev) => [src, ...prev]);
  }, []);

  return {
    socket,
    sessionId,
    clientUuid,
    socketConnected,
    socketStatus,
    peers,
    photos,
    sendPhoto,
    addLocalPhoto,
    sendSessionOffer,
    setSessionId,
    forceJoin,
    sendPeerDecision,
  };
}
