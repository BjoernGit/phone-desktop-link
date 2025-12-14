import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import "./App.css";

const socket = io();

function isMobileUA() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function newSessionId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `sess_${Math.random().toString(16).slice(2)}`;
}

function clampInt(v, min, max) {
  return Math.max(min, Math.min(max, v | 0));
}

export default function App() {
  const [isMobile, setIsMobile] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [socketState, setSocketState] = useState("disconnected");
  const [peerState, setPeerState] = useState("Keine Verbindung");
  const [photos, setPhotos] = useState([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [quality, setQuality] = useState("medium");

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    const mobile = isMobileUA();
    setIsMobile(mobile);

    const params = new URLSearchParams(window.location.search);
    let sid = params.get("session") || "";

    if (!sid && !mobile) {
      sid = newSessionId();
      const url = `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sid)}`;
      window.history.replaceState({}, "", url);
    }

    setSessionId(sid);

    socket.on("connect", () => setSocketState("connected"));
    socket.on("disconnect", () => setSocketState("disconnected"));

    socket.on("peer-joined", ({ role }) => {
      if (role === "mobile") setPeerState("Handy verbunden ✅");
      if (role === "desktop") setPeerState("Desktop verbunden ✅");
    });

    socket.on("peer-left", ({ role }) => {
      if (role === "mobile") setPeerState("Handy getrennt");
      if (role === "desktop") setPeerState("Desktop getrennt");
    });

    socket.on("photo", ({ imageDataUrl }) => {
      setPhotos((prev) => [imageDataUrl, ...prev]);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("peer-joined");
      socket.off("peer-left");
      socket.off("photo");
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    socket.emit("join-session", { sessionId, role: isMobile ? "mobile" : "desktop" });
  }, [sessionId, isMobile]);

  const desktopUrl = useMemo(() => {
    if (!sessionId) return window.location.origin;
    return `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sessionId)}`;
  }, [sessionId]);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  async function startCamera() {
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch (e) {
      stopCamera();
      alert(`Camera Error: ${e?.message || e}`);
    }
  }

  function qualityPreset() {
    if (quality === "small") return { maxW: 640, jpeg: 0.6 };
    if (quality === "large") return { maxW: 1600, jpeg: 0.85 };
    if (quality === "xlarge") return { maxW: 2048, jpeg: 0.9 };
    return { maxW: 1280, jpeg: 0.75 };
  }

  function takePhoto() {
    if (!sessionId) return;
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return;

    const { maxW, jpeg } = qualityPreset();
    const srcW = v.videoWidth;
    const srcH = v.videoHeight;

    const targetW = clampInt(Math.min(srcW, maxW), 320, maxW);
    const targetH = clampInt((srcH * targetW) / srcW, 240, 4096);

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(v, 0, 0, targetW, targetH);

    const imageDataUrl = canvas.toDataURL("image/jpeg", jpeg);

    socket.emit("photo", {
      sessionId,
      imageDataUrl,
      meta: { w: targetW, h: targetH, q: jpeg, preset: quality },
    });

    if (navigator.vibrate) navigator.vibrate(30);
  }

  if (!isMobile) {
    return (
      <div className="desktopRoot">
        <header className="desktopHeader">
          <div className="title">Phone ↔ Desktop Link</div>
          <div className="pill">
            Socket: <span className={socketState === "connected" ? "ok" : "bad"}>{socketState}</span>
          </div>
          <div className="pill">Status: {peerState}</div>
        </header>

        <section className="desktopCard">
          <div className="row">
            <div className="label">Session</div>
            <code className="code">{sessionId || "—"}</code>
          </div>

          <div className="qrCard">
            <QRCodeSVG
              value={desktopUrl}
              size={320}
              level="M"
              includeMargin={true}
              bgColor="#ffffff"
              fgColor="#000000"
            />
            <div className="qrLink">
              <a href={desktopUrl} target="_blank" rel="noreferrer">
                {desktopUrl}
              </a>
            </div>
          </div>
        </section>

        <section className="gallery">
          {photos.map((src, idx) => (
            <img key={idx} src={src} alt={`photo-${idx}`} />
          ))}
        </section>
      </div>
    );
  }

  return (
    <div className="mobileRoot">
      <div className="mobileTop">
        <div className="mobileTitle">Phone Link</div>
        <div className="mobileSub">
          Session: <code className="code">{sessionId || "—"}</code>
        </div>
      </div>

      {!sessionId ? (
        <div className="mobileCenter">
          Keine Session. Bitte QR-Code am Desktop scannen.
        </div>
      ) : (
        <>
          <div className="cameraStage" onClick={!cameraActive ? startCamera : undefined}>
            <video ref={videoRef} className="video" autoPlay playsInline muted />
            {!cameraActive && <div className="tapHint">Tippe auf den Bildschirm, um die Kamera zu starten</div>}
          </div>

          <div className="controls">
            <select value={quality} onChange={(e) => setQuality(e.target.value)} className="quality">
              <option value="small">Klein</option>
              <option value="medium">Mittel</option>
              <option value="large">Groß</option>
              <option value="xlarge">Sehr groß</option>
            </select>

            <button className="btnStop" onClick={stopCamera} disabled={!cameraActive}>
              Stop
            </button>

            <button className="btnShutter" onClick={takePhoto} disabled={!cameraActive} aria-label="Take photo" />

            <button className="btnStart" onClick={startCamera}>
              Start
            </button>
          </div>
        </>
      )}
    </div>
  );
}
