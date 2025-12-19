import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import "./App.css";
import heroLogo from "./assets/Snap2Desk_Text_Logo.png";
import { isMobileDevice } from "./utils/session";
import { toBlob } from "./utils/image";
import { useSessionSockets } from "./hooks/useSessionSockets";
import { useCameraCapture } from "./hooks/useCameraCapture";
import { QrPanel } from "./components/QrPanel";
import { PeerPanel } from "./components/PeerPanel";
import { PhotoGrid } from "./components/PhotoGrid";
import { Lightbox } from "./components/Lightbox";
import { DebugPanel } from "./components/DebugPanel";
import { FooterBar } from "./components/FooterBar";
import {
  decryptToDataUrl,
  encryptDataUrl,
  exportAesKey,
  generateAesKey,
  importAesKey,
} from "./utils/crypto";

export default function App() {
  const [isMobile, setIsMobile] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [debugDataUrl, setDebugDataUrl] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [panelHeights, setPanelHeights] = useState({ qr: 0, peer: 0 });
  const [sessionKey, setSessionKey] = useState(null);
  const [sessionKeyB64, setSessionKeyB64] = useState("");

  const qrPanelRef = useRef(null);
  const peerPanelRef = useRef(null);
  const displayKeyShort = sessionKeyB64 ? sessionKeyB64.slice(0, Math.ceil(sessionKeyB64.length / 2)) : "";

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
    return "Unbekanntes Geraet";
  }, []);

  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);

  const decryptPhoto = useCallback(
    async (payload) => {
      if (payload?.ciphertext && sessionKey) {
        return decryptToDataUrl(payload, sessionKey);
      }
      return payload?.imageDataUrl || null;
    },
    [sessionKey]
  );

  const { sessionId, peers, photos, sendPhoto, addLocalPhoto } = useSessionSockets({
    isMobile,
    deviceName,
    onDecryptPhoto: decryptPhoto,
  });

  const sendPhotoSecure = useCallback(
    async (imageDataUrl) => {
      if (!sessionId || !imageDataUrl) return;
      if (sessionKey) {
        try {
          const encrypted = await encryptDataUrl(imageDataUrl, sessionKey);
          sendPhoto(encrypted);
          return;
        } catch (e) {
          console.warn("Encrypt failed, sending plain", e);
        }
      }
      sendPhoto({ imageDataUrl });
    },
    [sessionId, sessionKey, sendPhoto]
  );

  const {
    videoRef,
    cameraReady,
    cameraError,
    isStartingCamera,
    handleStartCamera,
    handleShutter,
  } = useCameraCapture({ sessionId, onSendPhoto: sendPhotoSecure });

  const peerCount = peers.length;
  const hasPhotos = photos.length > 0;
  const hasConnection = peerCount > 0;
  const hasActiveUI = hasConnection || hasPhotos;
  const qrDocked = hasActiveUI;

  useLayoutEffect(() => {
    const measure = () => {
      const qr = qrPanelRef.current?.getBoundingClientRect().height ?? 0;
      const peer = peerPanelRef.current?.getBoundingClientRect().height ?? 0;
      setPanelHeights((prev) => (prev.qr === qr && prev.peer === peer ? prev : { qr, peer }));
    };

    const raf = requestAnimationFrame(measure);

    const roSupport = typeof ResizeObserver !== "undefined";
    const observers = [];
    if (roSupport) {
      if (qrPanelRef.current) {
        const ro = new ResizeObserver(measure);
        ro.observe(qrPanelRef.current);
        observers.push(ro);
      }
      if (peerPanelRef.current) {
        const ro = new ResizeObserver(measure);
        ro.observe(peerPanelRef.current);
        observers.push(ro);
      }
    } else {
      window.addEventListener("resize", measure);
    }

    return () => {
      cancelAnimationFrame(raf);
      observers.forEach((ro) => ro.disconnect());
      if (!roSupport) window.removeEventListener("resize", measure);
    };
  }, [qrPanelRef, peerPanelRef, isMobile, hasActiveUI]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const keyFromUrl = params.get("key");

    const importKey = async (keyStr) => {
      try {
        const k = await importAesKey(keyStr);
        setSessionKey(k);
        setSessionKeyB64(keyStr);
      } catch (e) {
        console.warn("Key import failed", e);
        setSessionKey(null);
        setSessionKeyB64("");
      }
    };

    const setup = async () => {
      if (!window.isSecureContext || !crypto?.subtle) {
        console.warn("WebCrypto not available, falling back to unencrypted mode");
        setSessionKey(null);
        setSessionKeyB64("");
        return;
      }
      if (isMobile) {
        if (keyFromUrl) await importKey(keyFromUrl);
        return;
      }
      if (keyFromUrl) {
        await importKey(keyFromUrl);
        return;
      }
      const newKey = await generateAesKey();
      const exported = await exportAesKey(newKey);
      params.set("key", exported);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, "", newUrl);
      setSessionKey(newKey);
      setSessionKeyB64(exported);
    };

    setup();
  }, [isMobile]);

  async function copyImageToClipboard(src) {
    const supportsImageClipboard = !!(navigator.clipboard?.write && window.ClipboardItem);
    try {
      if (supportsImageClipboard) {
        const tryWrite = async (blob, label) => {
          if (!blob) throw new Error("Kein Bild");
          const type = blob.type || "image/jpeg";
          const item = new ClipboardItem({ [type]: blob });
          await navigator.clipboard.write([item]);
          setCopyStatus(`${label} kopiert`);
          setTimeout(() => setCopyStatus(""), 1500);
        };

        try {
          const jpeg = await toBlob(src, "jpeg");
          await tryWrite(jpeg, "JPEG");
          return;
        } catch (errJpeg) {
          console.warn("JPEG-Clipboard fehlgeschlagen, versuche PNG:", errJpeg);
          const png = await toBlob(src, "png");
          await tryWrite(png, "PNG");
          return;
        }
      }
    } catch (e) {
      console.warn("Bild-Clipboard fehlgeschlagen, falle zurueck auf Text:", e);
    }
    try {
      await navigator.clipboard.writeText(src);
      setCopyStatus(
        supportsImageClipboard
          ? "Link kopiert (Bild-Clipboard blockiert)"
          : "Link kopiert (Bild-Clipboard nicht unterstuetzt)"
      );
      setTimeout(() => setCopyStatus(""), 1500);
    } catch (e) {
      setCopyStatus("Kopieren nicht moeglich");
      setTimeout(() => setCopyStatus(""), 1500);
    }
  }

  async function saveImage(src) {
    try {
      let blob = null;
      try {
        blob = await toBlob(src, "jpeg");
      } catch {
        blob = await toBlob(src, "png");
      }
      if (!blob) throw new Error("Kein Bild");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ext = blob.type === "image/png" ? "png" : "jpg";
      a.href = url;
      a.download = `photo-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("Speichern fehlgeschlagen:", e);
      setCopyStatus("Speichern nicht moeglich");
      setTimeout(() => setCopyStatus(""), 1500);
    }
  }

  function injectDebugPhoto() {
    if (!debugDataUrl.trim()) return;
    const src = debugDataUrl.trim();
    const looksOkay = src.startsWith("data:image") || src.startsWith("http://") || src.startsWith("https://");
    if (!looksOkay) {
      setCopyStatus("Ungueltige Quelle");
      setTimeout(() => setCopyStatus(""), 1200);
      return;
    }
    addLocalPhoto(src);
    setDebugDataUrl("");
  }

  if (!isMobile) {
    const buildUrl = () => {
      if (!sessionId) return window.location.href;
      const params = new URLSearchParams(window.location.search);
      params.set("session", sessionId);
      if (sessionKeyB64) params.set("key", sessionKeyB64);
      return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    };

    const url = buildUrl();
    const qrBaseSize = 240;
    const qrSize = hasActiveUI ? qrBaseSize * 0.8 : qrBaseSize;

    return (
      <div className="desktopShell">
        <div className="pageContent">
          <header className="desktopHero">
            <div className="heroCopy">
              <img className="heroLogo" src={heroLogo} alt="Snap2Desk Logo" />
              <div className="heroSub">
                Pics from your phone straight to your desktop. Fast, simple, safe, without an account.
              </div>
            </div>
          </header>

          {showDebug && (
            <DebugPanel
              value={debugDataUrl}
              onChange={setDebugDataUrl}
              onAdd={injectDebugPhoto}
              status={copyStatus}
              metrics={`qr: ${
                panelHeights.qr ? `${Math.round(panelHeights.qr)}px` : "n/a"
              } • peer: ${panelHeights.peer ? `${Math.round(panelHeights.peer)}px` : "n/a"}`}
            />
          )}

          {!hasActiveUI && (
            <div className="qrHeroWrap">
              <QrPanel ref={qrPanelRef} value={url} size={240} label="Scanne den QR-Code" className="heroCenter" />
            </div>
          )}

          {hasActiveUI && (
            <>
              <section
                className="pairingRow"
                style={{
                  "--qr-size": `${qrSize}px`,
                }}
              >
                <PeerPanel
                  ref={peerPanelRef}
                  peers={peers}
                  hasConnection={hasConnection}
                  style={panelHeights.qr ? { height: `${panelHeights.qr}px` } : undefined}
                />
                <QrPanel
                  ref={qrPanelRef}
                  value={url}
                  size={qrSize}
                  label={qrDocked ? "Weitere Geraete koppeln" : "Scanne den QR-Code"}
                  className={qrDocked ? "docked" : "centered"}
                />
              </section>

              <main className="desktopCanvas">
                {photos.length === 0 ? (
                  <div className="emptyInvite">
                    <div className="emptyCallout">Bereit, Fotos zu empfangen</div>
                    <div className="emptyHint">Scanne den QR-Code mit deinem Handy und tippe auf den Ausloeser.</div>
                  </div>
                ) : (
                  <PhotoGrid
                    photos={photos}
                    onSelect={setLightboxSrc}
                    onCopy={copyImageToClipboard}
                    onSave={saveImage}
                  />
                )}
              </main>
            </>
          )}
        </div>

        <Lightbox
          src={lightboxSrc}
          onClose={() => setLightboxSrc(null)}
          onCopy={copyImageToClipboard}
          onSave={saveImage}
        />

        <FooterBar onToggleDebug={() => setShowDebug((v) => !v)} />
      </div>
    );
  }

  return (
    <div className="mobileSimpleRoot">
      <div className="mobileDebugPill">
        <div className="pillLine">Session: {sessionId || "n/a"}</div>
        <div className="pillLine">Key: {displayKeyShort || "n/a"}</div>
      </div>
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
