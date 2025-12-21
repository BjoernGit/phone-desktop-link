import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { ensureDesktopSessionId, getSessionIdFromUrl } from "../utils/session";

function getSocketUrl() {
  return window.location.origin;
}

export function useSessionSockets({ isMobile, deviceName, onDecryptPhoto }) {
  const [sessionId, setSessionId] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [socketStatus, setSocketStatus] = useState("disconnected");
  const [peers, setPeers] = useState([]);
  const [photos, setPhotos] = useState([]);

  const socket = useMemo(() => {
    const isSecure = window.location.protocol === "https:";
    const url = getSocketUrl();
    const s = io(url, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      secure: isSecure,
      withCredentials: true,
    });

    s.on("connect_error", (err) => {
      console.warn("Socket connect_error", err?.message || err);
      setSocketStatus(`connect_error: ${err?.message || err}`);
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

  // connect/disconnect bookkeeping
  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => {
      setSocketConnected(false);
      setPeers([]);
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

    return () => {
      socket.off("peer-joined", onPeerJoined);
      socket.off("peer-left", onPeerLeft);
      socket.off("photo", onPhoto);
    };
  }, [deviceName, isMobile, sessionId, socket, onDecryptPhoto]);

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
    };
}
