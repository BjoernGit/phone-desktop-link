import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import "./App.css";

function getSessionIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("session");
}

function ensureDesktopSessionId() {
  const params = new URLSearchParams(window.location.search);
  let sessionId = params.get("session");

  if (!sessionId) {
    sessionId = (crypto.randomUUID?.() ?? `sess_${Date.now().toString(16)}`).slice(0, 8);
    params.set("session", sessionId);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", newUrl);
  }

  return sessionId;
}

function isMobileDevice() {
  return (
    (navigator.userAgentData && navigator.userAgentData.mobile) ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

export default function App() {
  const [isMobile, setIsMobile] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [photos, setPhotos] = useState([]);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [quality, setQuality] = useState("medium");

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const socket = useMemo(() => {
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    const url = isLocal ? "http://localhost:3000" : window.location.origin;
    return io(url, { transports: ["websocket"] });
  }, []);

  useEffect(() => {
    const mobile = isMobileDevice();
    setIsMobile(mobile);

    const sid = mobile ? (getSessionIdFromUrl() ?? "") : ensureDesktopSessionId();
    setSessionId(sid);

    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => {
      setSocketConnected(false);
      setPeerConnected(false);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
    };
  }, [socket]);

  useEffect(() => {
    if (!sessionId) return;

    const role = isMobile ? "mobile" : "desktop";
    socket.emit("join-session", { sessionId, role });

    const onPeerJoined = ({ role: joinedRole }) => {
      if (joinedRole === (isMobile ? "desktop" : "mobile")) setPeerConnected(true);
    };

    const onPeerLeft = ({ role: leftRole }) => {
      if (leftRole === (isMobile ? "desktop" : "mobile")) setPeerConnected(false);
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
  }, [socket, sessionId, isMobile]);

  useEffect(() => {
    return () => {
      stopCamera();
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }

  function getCaptureTarget() {
    switch (quality) {
      case "small":
        return { width: 640, height: 360, jpeg: 0.65 };
      case "medium":
        return { width: 1280, height: 720, jpeg: 0.75 };
      case "large":
        return { width: 1920, height: 1080, jpeg: 0.8 };
      case "xlarge":
        return { width: 2560, height: 1440, jpeg: 0.82 };
      default:
        return { width: 1280, height: 720, jpeg: 0.75 };
    }
  }

  async function startCamera() {
    setCameraError("");
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraReady(true);
    } catch (err) {
      setCameraError(err?.message ?? "Camera permission denied");
      setCameraReady(false);
    }
  }

  function takePhotoAndSend() {
    if (!cameraReady || !videoRef.current || !sessionId) return;

    const v = videoRef.current;
    const { width, height, jpeg } = getCaptureTarget();

    const vw = v.videoWidth || width;
    const vh = v.videoHeight || height;

    const scale = Math.min(width / vw, height / vh, 1);
    const outW = Math.floor(vw * scale);
    const outH = Math.floor(vh * scale);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(v, 0, 0, outW, outH);

    const imageDataUrl = canvas.toDataURL("image/jpeg", jpeg);
    socket.emit("photo", { sessionId, imageDataUrl });

    if (navigator.vibrate) navigator.vibrate(20);
  }

  if (!isMobile) {
    const url = sessionId
      ? `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sessionId)}`
      : window.location.href;

    return (
      <div className="desktopPage">
        <header className="desktopHeader">
          <div className="brand">
            <div className="brandTitle">Phone ↔ Desktop Link</div>
            <div className="brandSub">
              Socket: <strong>{socketConnected ? "connected" : "disconnected"}</strong> · Device:{" "}
              <strong>{peerConnected ? "paired" : "waiting"}</strong>
            </div>
          </div>

          <div className="desktopQrCard">
            <div className="desktopQrLabel">Scan QR to pair</div>
            <div className="desktopQrWrap">
              <QRCodeSVG value={url} size={220} />
            </div>
            <div className="desktopSession">
              Session: <code>{sessionId}</code>
            </div>
          </div>
        </header>

        <main className="desktopMain">
          <div className="desktopGrid">
            {photos.map((src, idx) => (
              <a key={idx} className="photoCard" href={src} target="_blank" rel="noreferrer">
                <img className="photoImg" src={src} alt={`Photo ${idx}`} />
              </a>
            ))}
          </div>

          {photos.length === 0 && (
            <div className="emptyState">
              <div className="emptyTitle">Noch keine Bilder</div>
              <div className="emptyText">Öffne den QR-Code auf dem Handy und drück den Shutter.</div>
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="mobileRoot">
      <div className="sessionPill" aria-label="Session ID">
        {sessionId ? `Session ${sessionId}` : "No session"}
      </div>

      {!cameraReady ? (
        <button
          type="button"
          className="tapToStart"
          onClick={startCamera}
          disabled={!sessionId}
          aria-label="Tap to start camera"
        >
          <div className="tapTitle">Tippe, um die Kamera zu starten</div>
          <div className="tapSub">
            {sessionId ? "Session ist gekoppelt" : "Bitte QR-Code vom Desktop scannen"}
          </div>
          {cameraError && <div className="tapError">{cameraError}</div>}
        </button>
      ) : (
        <div className="cameraStage">
          <video ref={videoRef} className="cameraVideo" playsInline muted autoPlay />
          <div className="cameraTopFade" />
          <div className="cameraBottomFade" />

          <div className="cameraControls">
            <div className="qualityWrap">
              <select
                className="qualitySelect"
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                aria-label="Image size"
              >
                <option value="small">Klein</option>
                <option value="medium">Mittel</option>
                <option value="large">Gross</option>
                <option value="xlarge">Sehr gross</option>
              </select>
            </div>

            <button
              type="button"
              className="shutter"
              onClick={takePhotoAndSend}
              aria-label="Take photo"
            >
              <span className="shutterInner" />
            </button>

            <button type="button" className="stopBtn" onClick={stopCamera} aria-label="Stop camera">
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
