import { useCallback, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { ensureDesktopSessionId, getSessionIdFromUrl } from "../utils/session";

function getSocketUrl() {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";
  return isLocal ? "http://localhost:3000" : window.location.origin;
}

export function useSessionSockets({ isMobile, deviceName }) {
  const [sessionId, setSessionId] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [peers, setPeers] = useState([]);
  const [photos, setPhotos] = useState([]);

  const socket = useMemo(() => io(getSocketUrl(), { transports: ["websocket"] }), []);

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

    const onPhoto = ({ imageDataUrl }) => {
      setPhotos((prev) => [imageDataUrl, ...prev]);
    };

    socket.on("peer-joined", onPeerJoined);
    socket.on("peer-left", onPeerLeft);
    socket.on("photo", onPhoto);

    return () => {
      socket.off("peer-joined", onPeerJoined);
      socket.off("peer-left", onPeerLeft);
      socket.off("photo", onPhoto);
    };
  }, [deviceName, isMobile, sessionId, socket]);

  // re-emit join on reconnect so peers repopulate after a drop
  useEffect(() => {
    if (!socketConnected || !sessionId) return;
    const role = isMobile ? "mobile" : "desktop";
    socket.emit("join-session", { sessionId, role, deviceName });
  }, [deviceName, isMobile, sessionId, socket, socketConnected]);

  // close socket on unmount
  useEffect(() => () => socket.close(), [socket]);

  const sendPhoto = useCallback(
    (imageDataUrl) => {
      if (!sessionId || !imageDataUrl) return;
      socket.emit("photo", { sessionId, imageDataUrl });
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
    peers,
    photos,
    sendPhoto,
    addLocalPhoto,
  };
}
