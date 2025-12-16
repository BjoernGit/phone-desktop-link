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
  const [peers, setPeers] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [quality, setQuality] = useState("medium");
  const [isStartingCamera, setIsStartingCamera] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const deviceName = useMemo(() => {
    const uaData = navigator.userAgentData;
    if (uaData?.platform) return uaData.platform;
    if (navigator.platform) return navigator.platform;
    const ua = navigator.userAgent || "";
    if (ua.includes("Android")) return "Android";
    if (ua.includes("iPhone")) return "iPhone";
    if (ua.includes("iPad")) return "iPad";
    if (ua.includes("Mac")) return "Mac";
    if (ua.includes("Win")) return "Windows";
    return "Unbekanntes Gerät";
  }, []);

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
      setPeers([]);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
    };
  }, [socket]);

  useEffect(() => {
    if (!sessionId) return;

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
  }, [socket, sessionId, isMobile]);

  // Re-emit join on reconnect so peers repopulate after a drop
  useEffect(() => {
    if (!socketConnected || !sessionId) return;
    const role = isMobile ? "mobile" : "desktop";
    socket.emit("join-session", { sessionId, role, deviceName });
  }, [socketConnected, sessionId, isMobile, socket, deviceName]);

  useEffect(() => {
    return () => {
      stopCamera();
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop camera when page/tab becomes inactive so the OS/browser releases the camera
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopCamera();
      }
    };

    const onBeforeUnload = () => stopCamera();

    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stopCamera);
    window.addEventListener("blur", stopCamera);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stopCamera);
      window.removeEventListener("blur", stopCamera);
      window.removeEventListener("beforeunload", onBeforeUnload);
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
        // try to play; some browsers resolve play() before first frame - wait for 'loadeddata'
        try {
          await v.play();
        } catch (e) {
          // ignore - user gesture may be required but we started from one
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
          if (track && 'ImageCapture' in window) {
            // try to grab a frame via ImageCapture as a fallback to get dims
            const imgCap = new ImageCapture(track);
            let grabbed = false;
            const tryGrab = async () => {
              try {
                const bmp = await imgCap.grabFrame();
                if (bmp && bmp.width && bmp.height) {
                  grabbed = true;
                  // update video element via setting a blob URL to ensure dimension availability
                  const off = document.createElement('canvas');
                  off.width = bmp.width;
                  off.height = bmp.height;
                  const ctx = off.getContext('2d');
                  ctx.drawImage(bmp, 0, 0);
                }
              } catch (e) {
                // ignore
              }
              return grabbed;
            };
            tryGrab();
          }
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
    // if no intrinsic video size yet, refuse to send - advise retry
    if (!v.videoWidth || !v.videoHeight) {
      setCameraError("No video frame yet - versuche erneut");
      return;
    }

    // Default target from quality, but if phone is portrait prefer portrait output
    let { width: targetW, height: targetH, jpeg } = getCaptureTarget();
    const isPortrait = v.videoHeight > v.videoWidth || window.innerHeight > window.innerWidth;
    if (isPortrait) {
      // enforce portrait 720x1280 as requested
      targetW = 720;
      targetH = 1280;
    }

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
      // video is wider than target - crop sides
      sW = Math.round(vh * targetAspect);
      sx = Math.round((vw - sW) / 2);
    } else if (srcAspect < targetAspect) {
      // video is taller than target - crop top/bottom
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

  async function handleStartCamera(e) {
    e?.stopPropagation?.();
    if (!sessionId || isStartingCamera) return;
    setCameraError("");
    setIsStartingCamera(true);
    await startCamera();
    setIsStartingCamera(false);
  }

  async function handleShutter(e) {
    e?.stopPropagation?.();
    await takePhotoAndSend();
  }

  function handleStopCamera(e) {
    e?.stopPropagation?.();
    stopCamera();
    setCameraError("");
  }

  function dataUrlToBlob(dataUrl) {
    const arr = dataUrl.split(",");
    if (arr.length < 2) return null;
    const mimeMatch = arr[0].match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const bstr = atob(arr[1]);
    const n = bstr.length;
    const u8arr = new Uint8Array(n);
    for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
    return new Blob([u8arr], { type: mime });
  }

  async function copyImageToClipboard(src) {
    try {
      if (navigator.clipboard && navigator.clipboard.write) {
        const blob = src.startsWith("data:") ? dataUrlToBlob(src) : await (await fetch(src)).blob();
        if (!blob) throw new Error("Kein Bild");
        const item = new ClipboardItem({ [blob.type]: blob });
        await navigator.clipboard.write([item]);
        setCopyStatus("Kopiert");
        setTimeout(() => setCopyStatus(""), 1500);
        return;
      }
    } catch (e) {
      // fallback below
    }
    try {
      await navigator.clipboard.writeText(src);
      setCopyStatus("Link kopiert");
      setTimeout(() => setCopyStatus(""), 1500);
    } catch (e) {
      setCopyStatus("Kopieren nicht möglich");
      setTimeout(() => setCopyStatus(""), 1500);
    }
  }

    if (!isMobile) {
    const url = sessionId
      ? `${window.location.origin}${window.location.pathname}?session=${encodeURIComponent(sessionId)}`
      : window.location.href;

    const peerCount = peers.length;
    const qrDocked = peerCount > 0 || photos.length > 0;

    return (
      <div className="desktopShell">
        <header className="desktopHero">
          <div className="heroCopy">
            <div className="heroTitle">SpeedLink</div>
            <div className="heroSub">Fotos vom Handy direkt auf deinen Desktop. Schnell und sicher.</div>
          </div>
        </header>

        <section className="pairingRow">
          <div className="peerPanel">
            <div className="panelTitle">Verbundene Geräte</div>
            <div className="panelMeta">
              <span className={`pill ${peerCount > 0 ? "ok" : "wait"}`}>
                <span className="dot" />
                {peerCount > 0 ? `${peerCount} Gerät(e) verbunden` : "Wartet auf Verbindung"}
              </span>
            </div>
            {peerCount > 0 ? (
              <div className="peerList">
                {peers.map((p) => (
                  <span key={p.id} className="peerTag">
                    {p.name || p.role}
                  </span>
                ))}
              </div>
            ) : (
              <div className="peerEmpty">Scanne den QR-Code, um ein Gerät zu koppeln.</div>
            )}
          </div>

          <div className={`qrPanel ${qrDocked ? "docked" : "centered"}`}>
            <div className="qrLabel">{qrDocked ? "Weitere Geraete koppeln" : "Scanne den QR-Code"}</div>
            <div className="qrWrap">
              <QRCodeSVG value={url} size={qrDocked ? 180 : 240} />
            </div>
          </div>
        </section>

        <main className="desktopCanvas">
          {photos.length === 0 ? (
            <div className="emptyInvite">
              <div className="emptyCallout">Bereit, Fotos zu empfangen</div>
              <div className="emptyHint">Scanne den QR-Code mit deinem Handy und tippe auf den Ausloeser.</div>
            </div>
          ) : (
            <div className="photoGrid">
              {photos.map((src, idx) => (
                <div
                  key={idx}
                  className="photoCard"
                  role="button"
                  tabIndex={0}
                  onClick={() => setLightboxSrc(src)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setLightboxSrc(src);
                    }
                  }}
                  aria-label={`Foto ${idx + 1} ansehen`}
                >
                  <img className="photoImg" src={src} alt={`Photo ${idx}`} />
                  <button
                    type="button"
                    className="copyBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyImageToClipboard(src);
                    }}
                    aria-label="In Zwischenablage kopieren"
                  >
                    Copy
                  </button>
                </div>
              ))}
            </div>
          )}
        </main>

        {lightboxSrc && (
          <div className="lightbox" onClick={() => setLightboxSrc(null)}>
            <img className="lightboxImg" src={lightboxSrc} alt="Vergrössertes Foto" />
            <button
              type="button"
              className="copyBtn lightboxCopy"
              onClick={(e) => {
                e.stopPropagation();
                copyImageToClipboard(lightboxSrc);
              }}
            >
              Copy
            </button>
          </div>
        )}
      </div>
    );
  }
// Minimal mobile UI: full-screen video only. First tap starts camera; subsequent taps take a photo.
  return (
    <div className="mobileSimpleRoot">
      <video ref={videoRef} className="mobileSimpleVideo" playsInline muted autoPlay />

      {!cameraReady && (
        <>
          <div className="mobileSimpleHint" aria-hidden>
            Tippe, um die Kamera freizugeben
          </div>
          <button type="button" className="startBtn" onClick={handleStartCamera} disabled={isStartingCamera}>
            {isStartingCamera ? "Startet..." : "Kamera starten"}
          </button>
          {cameraError && <div className="tapError">{cameraError}</div>}
        </>
      )}

      {cameraReady && (
        <button
          type="button"
          className="shutter singleShutter"
          onClick={handleShutter}
          aria-label="Foto aufnehmen und senden"
        />
      )}
    </div>
  );
}
