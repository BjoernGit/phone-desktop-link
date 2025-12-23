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
      // Nur Polling, Upgrade aus -> stabil bei HTTPS/Proxy
      transports: ["polling"],
      upgrade: false,
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
    console.log("setSessionId derived", { sid, isMobile, fromUrl: window.location.search });
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
      console.log("socket connected (client)", { socketId: socket.id });
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
    // Falls der Socket schon verbunden ist, setze den Status direkt
    if (socket.connected) {
      onConnect();
    }
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  // join session + peer/photo events
  useEffect(() => {
    if (!sessionId) return undefined;
    const role = isMobile ? "mobile" : "desktop";
    console.log("socket effect (events) for session", sessionId, "role", role, "connected?", socketConnected);

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
      console.log("session-offer received", payload);
      onSessionOffer?.(payload);
    });

    return () => {
      socket.off("peer-joined", onPeerJoined);
      socket.off("peer-left", onPeerLeft);
      socket.off("photo", onPhoto);
      socket.off("session-offer");
    };
  }, [deviceName, isMobile, sessionId, socket, onDecryptPhoto, onSessionOffer]);

  // emit join when connected/reconnected and sessionId is known
  useEffect(() => {
    if (!socketConnected || !sessionId) return;
    const role = isMobile ? "mobile" : "desktop";
    console.log("emit join-session (connected)", { sessionId, role, deviceName, socketId: socket.id });
    socket.emit("join-session", { sessionId, role, deviceName });
  }, [deviceName, isMobile, sessionId, socket, socketConnected]);

  const forceJoin = useCallback(() => {
    if (!sessionId) return;
    const role = isMobile ? "mobile" : "desktop";
    if (!socket.connected) {
      try {
        socket.connect();
      } catch (e) {
        console.warn("socket connect failed", e);
      }
    }
    console.log("emit join-session (manual/force)", { sessionId, role, deviceName, socketId: socket.id });
    socket.emit("join-session", { sessionId, role, deviceName });
  }, [deviceName, isMobile, sessionId, socket]);

  // Optional: manueller Join-Trigger (für Notfälle)
  useEffect(() => {
    const handler = () => {
      forceJoin();
    };
    window.addEventListener("manual-join", handler);
    return () => window.removeEventListener("manual-join", handler);
  }, [forceJoin]);

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
      console.log("send session-offer", { from: sessionId, target: targetSessionId, offer });
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
    forceJoin,
  };
}
