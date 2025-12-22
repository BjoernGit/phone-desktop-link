import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { ensureDesktopSessionId, getSessionIdFromUrl } from "../utils/session";

function getSocketUrl() {
  return window.location.origin;
}

export function useSessionSockets({ isMobile, deviceName, onDecryptPhoto, onSessionOffer }) {
  const [sessionId, setSessionId] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketStatus, setSocketStatus] = useState("connecting");
  const [peers, setPeers] = useState([]);
  const [photos, setPhotos] = useState([]);

  const socket = useMemo(() => {
    const isSecure = window.location.protocol === "https:";
    const url = getSocketUrl();
    const s = io(url, {
      path: "/socket.io",
      // Tunnel-freundlich: nur Polling, damit kein WS-Upgrade durch CF muss
      transports: ["polling"],
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
    const sid = isMobile ? getSessionIdFromUrl() ?? "" : ensureDesktopSessionId();
    setSessionId(sid);
  }, [isMobile]);

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
      setSocketConnected(true);
      setSocketStatus("connected");
    };
    const onDisconnect = (reason) => {
      setSocketConnected(false);
      setPeers([]);
      setSocketStatus(`disconnected${reason ? `: ${reason}` : ""}`);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  // join session + peer/photo events
  useEffect(() => {
    if (!sessionId) return undefined;
    const role = isMobile ? "mobile" : "desktop";
    socket.emit("join-session", { sessionId, role, deviceName });

    const onPeerJoined = ({ role: joinedRole, clientId, deviceName: joinedName }) => {
      if (joinedRole === (isMobile ? "desktop" : "mobile")) {
        setPeers((prev) => {
          if (prev.some((p) => p.id === clientId)) return prev;
          return [...prev, { id: clientId, role: joinedRole, name: joinedName || "Gerät" }];
        });
      }
    };

    const onPeerLeft = ({ role: leftRole, clientId }) => {
      if (leftRole === (isMobile ? "desktop" : "mobile")) {
        setPeers((prev) => prev.filter((p) => p.id !== clientId));
      }
    };

    const onPhoto = async (payload) => {
      if (payload?.ciphertext && onDecryptPhoto) {
        try {
          const decrypted = await onDecryptPhoto(payload);
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
      onSessionOffer?.(payload);
    });

    return () => {
      socket.off("peer-joined", onPeerJoined);
      socket.off("peer-left", onPeerLeft);
      socket.off("photo", onPhoto);
      socket.off("session-offer");
    };
  }, [deviceName, isMobile, sessionId, socket, onDecryptPhoto, onSessionOffer]);

  // re-emit join on reconnect so peers repopulate after a drop
  useEffect(() => {
    if (!socketConnected || !sessionId) return;
    const role = isMobile ? "mobile" : "desktop";
    socket.emit("join-session", { sessionId, role, deviceName });
  }, [deviceName, isMobile, sessionId, socket, socketConnected]);

  // close socket on unmount
  useEffect(() => () => socket.close(), [socket]);

  const sendPhoto = useCallback(
    (payload) => {
      if (!sessionId || !payload) return;
      socket.emit("photo", { sessionId, ...payload });
    },
    [sessionId, socket]
  );

  const sendSessionOffer = useCallback(
    (offer, targetSessionId) => {
      if (!sessionId || !offer) return;
      socket.emit("session-offer", { sessionId, offer, target: targetSessionId });
    },
    [sessionId, socket]
  );

  const addLocalPhoto = useCallback((src) => {
    if (!src) return;
    setPhotos((prev) => [src, ...prev]);
  }, []);

  return {
    sessionId,
    socketConnected,
    socketStatus,
    peers,
    photos,
    sendPhoto,
    addLocalPhoto,
    sendSessionOffer,
    setSessionId,
  };
}
