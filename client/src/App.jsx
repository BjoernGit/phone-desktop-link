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
  deriveAesKeyFromSeed,
  generateSeedBase64Url,
  exportAesKeyBase64Url,
} from "./utils/crypto";

export default function App() {
  const [isMobile, setIsMobile] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [debugDataUrl, setDebugDataUrl] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [panelHeights, setPanelHeights] = useState({ qr: 0, peer: 0 });
  const [sessionKey, setSessionKey] = useState(null);
  const [sessionSeed, setSessionSeed] = useState("");
  const [sessionKeyB64, setSessionKeyB64] = useState("");
  const [encStatus, setEncStatus] = useState("idle");
  const [seedInitialized, setSeedInitialized] = useState(false);

  const qrPanelRef = useRef(null);
  const peerPanelRef = useRef(null);

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
        try {
          const result = await decryptToDataUrl(payload, sessionKey);
          setEncStatus("decrypt-ok");
          return result;
        } catch (e) {
          console.warn("Decrypt failed", e);
          setEncStatus("decrypt-fail");
          return null;
        }
      }
      if (payload?.ciphertext && !sessionKey) {
        setEncStatus("decrypt-missing-key");
        return null;
      }
      // plain payloads werden ignoriert, um Verschluesselung zu erzwingen
      if (payload?.imageDataUrl) {
        setEncStatus("plain-ignored");
      }
      return null;
    },
    [sessionKey]
  );

  const { sessionId, peers, photos, sendPhoto, addLocalPhoto } = useSessionSockets({
    isMobile,
    deviceName,
    onDecryptPhoto: decryptPhoto,
  });

  const applySeed = useCallback(
    async (seed) => {
      setSessionSeed(seed);
      if (!seed || !sessionId) {
        setSessionKey(null);
        setSessionKeyB64("");
        setEncStatus("missing-seed");
        return;
      }
      try {
        const key = await deriveAesKeyFromSeed(seed, sessionId);
        const keyB64 = await exportAesKeyBase64Url(key);
        setSessionKey(key);
        setSessionKeyB64(keyB64);
        setEncStatus("key-ready");
      } catch (e) {
        console.warn("Key derive/import failed", e);
        setSessionKey(null);
        setSessionKeyB64("");
        setEncStatus("key-error");
      }
    },
    [sessionId]
  );

  const sendPhotoSecure = useCallback(
    async (imageDataUrl) => {
      if (!sessionId || !imageDataUrl) return;
      if (!sessionKey) {
        setEncStatus("no-key");
        setCopyStatus("Kein Key - Foto nicht gesendet");
        setTimeout(() => setCopyStatus(""), 1500);
        return;
      }
      try {
        const encrypted = await encryptDataUrl(imageDataUrl, sessionKey);
        sendPhoto({ ...encrypted });
        setEncStatus("sent-encrypted");
      } catch (e) {
        console.warn("Encrypt failed", e);
        setEncStatus("encrypt-fail");
      }
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
    if (!sessionId || seedInitialized) return;

    const params = new URLSearchParams(window.location.search);
    if (params.has("key")) {
      params.delete("key");
      const search = params.toString();
      const newUrl = search
        ? `${window.location.pathname}?${search}${window.location.hash || ""}`
        : `${window.location.pathname}${window.location.hash || ""}`;
      window.history.replaceState({}, "", newUrl);
    }

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const seedFromHash = hashParams.get("seed") || "";

    const setup = async () => {
      if (!window.isSecureContext || !crypto?.subtle) {
        console.warn("WebCrypto not available, falling back to unencrypted mode");
        setSessionKey(null);
        setSessionKeyB64("");
        setSeedInitialized(true);
        return;
      }

      const seed = isMobile ? seedFromHash : sessionSeed || seedFromHash || generateSeedBase64Url(16);
      if (!seed) {
        setEncStatus("no-seed");
        setSeedInitialized(true);
        return;
      }

      await applySeed(seed);
      setSeedInitialized(true);
    };

    setup();
  }, [applySeed, isMobile, seedInitialized, sessionId, sessionSeed]);

  const handleSeedInput = useCallback(
    (value) => {
      const trimmed = value.trim();
      applySeed(trimmed);
    },
    [applySeed]
  );

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

  async function copyPlainUrl(src) {
    try {
      await navigator.clipboard.writeText(src);
      setCopyStatus("Data-URL kopiert");
      setTimeout(() => setCopyStatus(""), 1500);
    } catch (e) {
      console.warn("Plain copy failed", e);
      setCopyStatus("Kopieren nicht moeglich");
      setTimeout(() => setCopyStatus(""), 1500);
    }
  }

  async function copyEncrypted(src) {
    if (!sessionKey) {
      setCopyStatus("Kein Key - verschluesselt nicht kopiert");
      setTimeout(() => setCopyStatus(""), 1500);
      return;
    }
    try {
      const payload = await encryptDataUrl(src, sessionKey);
      await navigator.clipboard.writeText(JSON.stringify(payload));
      setCopyStatus("Verschluesselt kopiert");
      setTimeout(() => setCopyStatus(""), 1500);
    } catch (e) {
      console.warn("Encrypted copy failed", e);
      setCopyStatus("Verschluesseltes Kopieren fehlgeschlagen");
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

  async function injectDebugPhoto() {
    if (!debugDataUrl.trim()) return;
    const src = debugDataUrl.trim();

    try {
      const parsed = JSON.parse(src);
      if (parsed?.ciphertext) {
        if (!sessionKey) {
          setCopyStatus("Kein Key zum Entschluesseln");
          setTimeout(() => setCopyStatus(""), 1500);
          return;
        }
        try {
          const decrypted = await decryptToDataUrl(parsed, sessionKey);
          addLocalPhoto(decrypted);
          setCopyStatus("Entschluesselt importiert");
          setTimeout(() => setCopyStatus(""), 1500);
        } catch (e) {
          console.warn("Decrypt debug import failed", e);
          setCopyStatus("Decrypt fehlgeschlagen");
          setTimeout(() => setCopyStatus(""), 1500);
        }
        setDebugDataUrl("");
        return;
      }
    } catch (e) {
      // Not JSON, fall through
    }

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
      params.delete("key");
      params.set("session", sessionId);
      const hash = sessionSeed ? `#seed=${sessionSeed}` : "";
      return `${window.location.origin}${window.location.pathname}?${params.toString()}${hash}`;
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
              metrics={`seed: ${sessionSeed || "n/a"} | key: ${sessionKeyB64 || "n/a"} | enc: ${encStatus}`}
              seedValue={sessionSeed}
              onSeedChange={handleSeedInput}
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
                    showDebug={showDebug}
                    onCopyPlain={copyPlainUrl}
                    onCopyEncrypted={copyEncrypted}
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
          showDebug={showDebug}
          onCopyPlain={copyPlainUrl}
          onCopyEncrypted={copyEncrypted}
        />

        <FooterBar onToggleDebug={() => setShowDebug((v) => !v)} />
      </div>
    );
  }

  return (
    <div className="mobileSimpleRoot">
      <div className="mobileDebugPill">
        <div className="pillLine">Session: {sessionId || "n/a"}</div>
        <label className="pillLine pillLabel">
          Seed:
          <input
            className="pillInput"
            value={sessionSeed || ""}
            placeholder="seed"
            onChange={(e) => handleSeedInput(e.target.value)}
          />
        </label>
        <div className="pillLine">Key: {sessionKeyB64 || "n/a"}</div>
        <div className="pillLine">ENC: {encStatus}</div>
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
