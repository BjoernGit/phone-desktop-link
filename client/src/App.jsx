import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import "./App.css";

function createSessionId() {
  return (crypto.randomUUID?.() || `sess_${Math.random().toString(16).slice(2)}`).slice(0, 8);
}

function isMobileUA() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export default function App() {
  const [isMobile, setIsMobile] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState("disconnected");
  const [photos, setPhotos] = useState([]);

  const socket = useMemo(() => io(), []);

  useEffect(() => {
    setIsMobile(isMobileUA());

    const params = new URLSearchParams(window.location.search);
    let sid = params.get("session");

    if (!sid && !isMobileUA()) {
      sid = createSessionId();
      const newUrl = `${window.location.pathname}?session=${encodeURIComponent(sid)}`;
      window.history.replaceState({}, "", newUrl);
    }

    if (sid) setSessionId(sid);
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    const channel = `session-${sessionId}`;

    const onConnect = () => setStatus("connected");
    const onDisconnect = () => setStatus("disconnected");
    const onPhoto = (imageDataUrl) => setPhotos((p) => [imageDataUrl, ...p]);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on(channel, onPhoto);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off(channel, onPhoto);
    };
  }, [socket, sessionId]);

  if (!sessionId) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Phone ↔ Desktop Link</h1>
        <p>Keine Session-ID in der URL.</p>
      </div>
    );
  }

  if (!isMobile) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Phone ↔ Desktop Link 💻</h1>
        <p>Session: <strong>{sessionId}</strong></p>
        <p>Socket: <strong>{status}</strong></p>

        <div style={{ marginTop: 16 }}>
          <QRCodeSVG value={window.location.href} size={220} />
        </div>

        <div style={{ marginTop: 16 }}>
          {photos.map((src, i) => (
            <img key={i} src={src} alt={`photo-${i}`} style={{ maxWidth: 520, display: "block", marginTop: 12 }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Phone ↔ Desktop Link 📱</h1>
      <p>Session: <strong>{sessionId}</strong></p>
      <p>Socket: <strong>{status}</strong></p>
      <p>Mobile UI kommt als nächster Schritt – erstmal Deploy stabilisieren.</p>
    </div>
  );
}
