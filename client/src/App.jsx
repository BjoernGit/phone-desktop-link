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
        const v = videoRef.current;
        v.srcObject = stream;
        // try to play; some browsers resolve play() before first frame — wait for 'loadeddata'
        try {
          await v.play();
        } catch (e) {
          // ignore — user gesture may be required but we started from one
        }
        await new Promise((res) => {
          if (v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && v.videoWidth > 0) return res();
          let settled = false;

          const onLoaded = () => {
            if (!settled) {
              settled = true;
              cleanup();
              res();
            }
          };

          const onFrame = () => {
            if (!settled && v.videoWidth > 0) {
              settled = true;
              cleanup();
              res();
            }
          };

          const cleanup = () => {
            v.removeEventListener("loadeddata", onLoaded);
            if (v.cancelVideoFrameCallback && vfId != null) v.cancelVideoFrameCallback(vfId);
            clearTimeout(timeout);
            if (track) {
              track.removeEventListener("unmute", onFrame);
              track.removeEventListener("mute", onFrame);
            }
          };

          v.addEventListener("loadeddata", onLoaded);

          // prefer requestVideoFrameCallback when available
          let vfId = null;
          if (v.requestVideoFrameCallback) {
            const loop = () => {
              if (settled) return;
              if (v.videoWidth > 0) {
                onFrame();
                return;
              }
              vfId = v.requestVideoFrameCallback(loop);
            };
            vfId = v.requestVideoFrameCallback(loop);
          }

          // listen for track unmute as an additional signal
          const track = stream.getVideoTracks()[0];
          if (track) {
            track.addEventListener("unmute", onFrame);
            track.addEventListener("mute", onFrame);
          }

          const timeout = setTimeout(() => {
            if (!settled) {
              settled = true;
              cleanup();
              res();
            }
          }, 3000);
        });
      }

      setCameraReady(true);
    } catch (err) {
      setCameraError(err?.message ?? "Camera permission denied");
      setCameraReady(false);
    }
  }

  async function takePhotoAndSend() {
    if (!cameraReady || !videoRef.current || !sessionId) return;

    const v = videoRef.current;
    // if no intrinsic video size yet, refuse to send — advise retry
    if (!v.videoWidth || !v.videoHeight) {
      setCameraError("No video frame yet — versuche erneut");
      return;
    }

    const { width: targetW, height: targetH, jpeg } = getCaptureTarget();

    // Wait briefly for the video to have frame data to avoid capturing a black frame
    if (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || v.videoWidth === 0) {
      await new Promise((res) => {
        let settled = false;
        const onLoaded = () => {
          if (!settled) {
            settled = true;
            cleanup();
            res();
          }
        };
        const cleanup = () => {
          v.removeEventListener("loadeddata", onLoaded);
          clearTimeout(timeout);
        };
        v.addEventListener("loadeddata", onLoaded);
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            cleanup();
            res();
          }
        }, 500);
      });
    }

    const vw = v.videoWidth || targetW;
    const vh = v.videoHeight || targetH;

    // Compute source crop so the resulting image matches the requested aspect ratio
    const srcAspect = vw / vh;
    const targetAspect = targetW / targetH;

    let sx = 0,
      sy = 0,
      sW = vw,
      sH = vh;

    if (srcAspect > targetAspect) {
      // video is wider than target — crop sides
      sW = Math.round(vh * targetAspect);
      sx = Math.round((vw - sW) / 2);
    } else if (srcAspect < targetAspect) {
      // video is taller than target — crop top/bottom
      sH = Math.round(vw / targetAspect);
      sy = Math.round((vh - sH) / 2);
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext("2d", { alpha: false });

    // If the frame looks black, retry a few times (helps on some phones where the first frames are dark)
    const maxTries = 3;
    let tries = 0;
    let sent = false;

    while (tries < maxTries && !sent) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(v, sx, sy, sW, sH, 0, 0, targetW, targetH);

      // sample a small central area to detect mostly-dark frames
      try {
        const sampleW = Math.min(20, canvas.width);
        const sampleH = Math.min(20, canvas.height);
        const sxp = Math.floor((canvas.width - sampleW) / 2);
        const syp = Math.floor((canvas.height - sampleH) / 2);
        const img = ctx.getImageData(sxp, syp, sampleW, sampleH).data;
        let sum = 0;
        for (let i = 0; i < img.length; i += 4) {
          // luminance approximation
          sum += 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
        }
        const avg = sum / (sampleW * sampleH);
        if (avg < 12 && tries < maxTries - 1) {
          // too dark, wait a bit and retry
          await new Promise((res) => setTimeout(res, 220));
          tries += 1;
          continue;
        }
      } catch (e) {
        // if getImageData fails (CORS/webgl oddities) proceed to send once
      }

      const imageDataUrl = canvas.toDataURL("image/jpeg", jpeg);
      socket.emit("photo", { sessionId, imageDataUrl });
      sent = true;
    }

    if (navigator.vibrate) navigator.vibrate(20);
  }

  // small debug state visible on mobile while developing
  const [dbg, setDbg] = useState({ readyState: 0, vw: 0, vh: 0, tracks: 0, lastSend: "-" });

  useEffect(() => {
    let rafId;
    const t = () => {
      const v = videoRef.current;
      const s = streamRef.current;
      if (v) {
        setDbg({
          readyState: v.readyState,
          vw: v.videoWidth || 0,
          vh: v.videoHeight || 0,
          tracks: s ? s.getTracks().length : 0,
          lastSend: dbg.lastSend,
        });
      }
      rafId = requestAnimationFrame(t);
    };
    rafId = requestAnimationFrame(t);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <div className="tapTitle">Tippe hier für Unlock</div>
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

            <div className="mobileDebug" aria-hidden>
              <div>ready: {dbg.readyState}</div>
              <div>
                {dbg.vw}×{dbg.vh} · tracks: {dbg.tracks}
              </div>
            </div>
          {dbg.vw === 0 && (
            <div className="noFrameOverlay">
              <div>No video frame yet</div>
              <div className="noFrameActions">
                <button
                  type="button"
                  className="retryBtn"
                  onClick={async () => {
                    setCameraError("");
                    stopCamera();
                    await startCamera();
                  }}
                >
                  Retry camera
                </button>
              </div>
            </div>
          )}

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
