import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./App.css";
import { isMobileDevice } from "./utils/session";
import { toBlob } from "./utils/image";
import { useSessionSockets } from "./hooks/useSessionSockets";
import { useCameraCapture } from "./hooks/useCameraCapture";
import jsQR from "jsqr";
import { QrPanel } from "./components/QrPanel";
import { Lightbox } from "./components/Lightbox";
import { DebugPanel } from "./components/DebugPanel";
import { FooterBar } from "./components/FooterBar";
import { SessionOfferBar } from "./components/SessionOfferBar";
import { MobileDebugPill } from "./components/MobileDebugPill";
import { MobileControls } from "./components/MobileControls";
import { DesktopHero } from "./components/DesktopHero";
import { PairingRow } from "./components/PairingRow";
import { DesktopCanvas } from "./components/DesktopCanvas";
import { decryptToDataUrl, encryptDataUrl, generateSeedBase64Url } from "./utils/crypto";
import { useEncryption } from "./hooks/useEncryption";
import { CookiesContent } from "./pages/CookiesPage";
import { PrivacyContent } from "./pages/PrivacyPage";
import { TermsContent } from "./pages/TermsPage";
import { ImpressumContent } from "./pages/ImpressumPage";

export default function App() {
  const [isMobile, setIsMobile] = useState(() => isMobileDevice());
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [debugDataUrl, setDebugDataUrl] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [panelHeights, setPanelHeights] = useState({ qr: 0, peer: 0 });
  const [sessionSeed, setSessionSeed] = useState("");
  const [encStatus, setEncStatus] = useState("idle");
  const [seedInitialized, setSeedInitialized] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const fileInputRef = useRef(null);
  const sessionKeyRef = useRef(null);
  const [qrMode, setQrMode] = useState(false);
  const [qrStatus, setQrStatus] = useState("");
  const [qrOffer, setQrOffer] = useState(null);
  const [incomingOffer, setIncomingOffer] = useState(null);
  const [offerStatus, setOfferStatus] = useState("idle");
  const location = useLocation();
  const navigate = useNavigate();

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
      const key = sessionKeyRef.current;
      if (payload?.ciphertext && key) {
        try {
          const result = await decryptToDataUrl(payload, key);
          setEncStatus("decrypt-ok");
          return result;
        } catch (e) {
          console.warn("Decrypt failed", e);
          setEncStatus("decrypt-fail");
          return null;
        }
      }
      if (payload?.ciphertext && !key) {
        setEncStatus("decrypt-missing-key");
        return null;
      }
      // plain payloads werden ignoriert, um Verschlsselung zu erzwingen
      if (payload?.imageDataUrl) {
        setEncStatus("plain-ignored");
      }
      return null;
    },
    [] // key is taken from ref; setEncStatus is stable
  );

  const {
    sessionId,
    peers,
    photos,
    sendPhoto,
    addLocalPhoto,
    socketStatus,
    sendSessionOffer,
    setSessionId: overrideSessionId,
  } = useSessionSockets({
    isMobile,
    deviceName,
    onDecryptPhoto: decryptPhoto,
    onSessionOffer: (payload) => {
      if (!payload?.session && !payload?.seed) return;
      setOfferStatus("Offer eingegangen");
      setIncomingOffer({
        session: payload.session,
        seed: payload.seed || "",
        from: payload.fromDevice || payload.fromRole || "Peer",
      });
    },
  });

  const { sessionKey, sessionKeyB64, applySeed } = useEncryption(sessionId, setEncStatus);

  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  const applySeedAndStore = useCallback(
    async (seed, sessionOverride) => {
      setSessionSeed(seed);
      await applySeed(seed, sessionOverride);
    },
    [applySeed]
  );

  const applyQrOffer = useCallback(
    (offer) => {
      if (!offer?.session) {
        setQrStatus("Kein Session-Parameter im QR");
        return;
      }
      const params = new URLSearchParams(window.location.search);
      params.set("session", offer.session);
      const hash = offer.seed ? `#seed=${offer.seed}` : "";
      const newUrl = `${window.location.pathname}?${params.toString()}${hash}`;
      window.history.replaceState({}, "", newUrl);
      overrideSessionId?.(offer.session);
      if (offer.seed) {
        applySeedAndStore(offer.seed, offer.session);
      }
      setQrStatus("Session uebernommen");
      setTimeout(() => setQrStatus(""), 2000);
    },
    [applySeedAndStore, overrideSessionId]
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
    quality,
    setQuality,
    handleFiles,
  } = useCameraCapture({
    sessionId,
    onSendPhoto: sendPhotoSecure,
  });

  useEffect(() => {
    if (!qrMode) return undefined;
    setQrStatus("QR-Scan aktiv");
    setQrOffer(null);
    let active = true;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const parseQr = (raw) => {
      try {
        const url = new URL(raw);
        const session = url.searchParams.get("session") || "";
        const seed = url.hash ? new URLSearchParams(url.hash.replace(/^#/, "")).get("seed") || "" : "";
        return { session, seed, raw };
      } catch (e) {
        return { session: "", seed: "", raw };
      }
    };

    const scan = () => {
      if (!active) return;
      const v = videoRef.current;
      if (!v || !v.videoWidth || !v.videoHeight) {
        requestAnimationFrame(scan);
        return;
      }
      const maxW = 320;
      const scale = Math.min(1, maxW / v.videoWidth);
      const w = Math.max(120, Math.round(v.videoWidth * scale));
      const h = Math.max(120, Math.round(v.videoHeight * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(v, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const result = jsQR(imgData.data, w, h);
      if (result?.data) {
        const parsed = parseQr(result.data);
        setQrStatus(parsed.session ? `QR erkannt: ${parsed.session}` : "QR erkannt");
        setQrOffer(parsed);
        setQrMode(false);
        setTimeout(() => setQrStatus(""), 4000);
        return;
      }
      requestAnimationFrame(scan);
    };

    requestAnimationFrame(scan);
    return () => {
      active = false;
      setQrStatus("");
    };
  }, [qrMode, videoRef]);

  const peerCount = peers.length;
  const hasPhotos = photos.length > 0;
  const hasConnection = peerCount > 0;
  const hasActiveUI = hasConnection || hasPhotos;
  const qrDocked = hasActiveUI;
  const isTouch = useMemo(() => (navigator?.maxTouchPoints || 0) > 1, []);
  const missingSeed = (!sessionId || !sessionSeed) && (isMobile || isTouch);
  const legalContentMap = useMemo(
    () => ({
      "/datenschutz": <PrivacyContent />,
      "/cookies": <CookiesContent />,
      "/agb": <TermsContent />,
      "/impressum": <ImpressumContent />,
    }),
    []
  );
  const legalContent = legalContentMap[location.pathname];
  const legalOpen = !!legalContent && location.pathname !== "/";
  useEffect(() => {
    if (!cameraReady && showQualityPicker) {
      setShowQualityPicker(false);
    }
  }, [cameraReady, showQualityPicker]);

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

      await applySeedAndStore(seed);
      setSeedInitialized(true);
    };

    setup();
  }, [applySeedAndStore, isMobile, seedInitialized, sessionId, sessionSeed]);

  const handleSeedInput = useCallback(
    (value) => {
      const trimmed = value.trim();
      applySeedAndStore(trimmed);
    },
    [applySeedAndStore]
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
      console.warn("Bild-Clipboard fehlgeschlagen, falle zurck auf Text:", e);
    }
    try {
      await navigator.clipboard.writeText(src);
      setCopyStatus(
        supportsImageClipboard
          ? "Link kopiert (Bild-Clipboard blockiert)"
          : "Link kopiert (Bild-Clipboard nicht untersttzt)"
      );
      setTimeout(() => setCopyStatus(""), 1500);
    } catch (e) {
      setCopyStatus("Kopieren nicht mglich");
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
      setCopyStatus("Kopieren nicht mglich");
      setTimeout(() => setCopyStatus(""), 1500);
    }
  }

  async function copyEncrypted(src) {
    if (!sessionKey) {
      setCopyStatus("Kein Key - verschlsselt nicht kopiert");
      setTimeout(() => setCopyStatus(""), 1500);
      return;
    }
    try {
      const payload = await encryptDataUrl(src, sessionKey);
      await navigator.clipboard.writeText(JSON.stringify(payload));
      setCopyStatus("Verschlsselt kopiert");
      setTimeout(() => setCopyStatus(""), 1500);
    } catch (e) {
      console.warn("Encrypted copy failed", e);
      setCopyStatus("Verschlsseltes Kopieren fehlgeschlagen");
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
      setCopyStatus("Speichern nicht mglich");
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
          setCopyStatus("Kein Key zum Entschlsseln");
          setTimeout(() => setCopyStatus(""), 1500);
          return;
        }
        try {
          const decrypted = await decryptToDataUrl(parsed, sessionKey);
          addLocalPhoto(decrypted);
          setCopyStatus("Entschlsselt importiert");
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
      setCopyStatus("Ungltige Quelle");
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
      <>
        <div className="desktopShell">
            <div className="pageContent">
              <DesktopHero />

            {incomingOffer && !isMobile && (
              <SessionOfferBar
                offer={incomingOffer}
                onDecline={() => {
                  setIncomingOffer(null);
                  setOfferStatus("Offer abgelehnt");
                }}
                onAccept={() => {
                  applyQrOffer(incomingOffer);
                  setIncomingOffer(null);
                  setOfferStatus("Offer bernommen");
                }}
              />
            )}

            {showDebug && (
              <DebugPanel
                value={debugDataUrl}
                onChange={setDebugDataUrl}
                onAdd={injectDebugPhoto}
                status={copyStatus || qrStatus}
                metrics={`seed: ${sessionSeed || "n/a"} | key: ${sessionKeyB64 || "n/a"} | enc: ${encStatus} | offer: ${offerStatus}`}
                seedValue={sessionSeed}
                onSeedChange={handleSeedInput}
                offerStatus={offerStatus}
              />
            )}

            {!hasActiveUI && (
              <div className="qrHeroWrap">
                <QrPanel ref={qrPanelRef} value={url} size={240} label="Scanne den QR-Code" className="heroCenter" />
              </div>
            )}

            {hasActiveUI && (
              <>
                  <PairingRow
                    qrSize={qrSize}
                    qrDocked={qrDocked}
                    url={url}
                    qrPanelRef={qrPanelRef}
                    peerPanelRef={peerPanelRef}
                    hasConnection={hasConnection}
                    panelHeights={panelHeights}
                    peers={peers}
                  />

                  <main className="desktopCanvas">
                    <DesktopCanvas
                      photos={photos}
                      onSelect={setLightboxSrc}
                      onCopy={copyImageToClipboard}
                      onSave={saveImage}
                      showDebug={showDebug}
                      onCopyPlain={copyPlainUrl}
                      onCopyEncrypted={copyEncrypted}
                    />
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

        {legalOpen && (
          <div className="legalModal" onClick={() => navigate("/")}>
            <div
              className="legalModalCard"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <button type="button" className="legalClose" onClick={() => navigate("/")}>
                &times;
              </button>
              <div className="legalModalBody">{legalContent}</div>
            </div>
          </div>
        )}
      </>
    );
  }

  if (missingSeed) {
    return (
      <div className="mobileSimpleRoot">
        <div className="mobileBlocked">
          <h2>QR-Code scannen</h2>
          <p>Bitte rufe Snap2Desk auf deinem Desktop/Laptop auf und scanne dort den QR-Code mit deiner Handy-Kamera.</p>
          <p>
            Website:{" "}
            <a className="mobileLink" href="https://snap2desk.com" target="_blank" rel="noreferrer">
              snap2desk.com
            </a>
          </p>
          <p>Starte die Kamera-App auf dem Handy, scanne den Code und folge dem Link. Dann erscheint hier die App.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mobileSimpleRoot">
      <MobileDebugPill
        sessionId={sessionId}
        sessionSeed={sessionSeed}
        sessionKeyB64={sessionKeyB64}
        encStatus={encStatus}
        offerStatus={offerStatus}
        qrStatus={qrStatus}
        onSeedChange={handleSeedInput}
      />

      <MobileControls
        videoRef={videoRef}
        cameraReady={cameraReady}
        cameraError={cameraError}
        isStartingCamera={isStartingCamera}
        handleStartCamera={handleStartCamera}
        handleShutter={handleShutter}
        fileInputRef={fileInputRef}
        handleFiles={handleFiles}
        qrMode={qrMode}
        setQrMode={setQrMode}
        setQrOffer={setQrOffer}
        handleStartQrCamera={handleStartCamera}
        quality={quality}
        setQuality={setQuality}
        showQualityPicker={showQualityPicker}
        setShowQualityPicker={setShowQualityPicker}
      />

      {qrOffer?.session && (
        <div className="qrOfferPanel">
          <div className="qrOfferText">
            QR erkannt
            <div className="qrOfferMeta">
              Session: <code>{qrOffer.session}</code>
              {qrOffer.seed ? (
                <>
                  <br />
                  Seed: <code>{qrOffer.seed}</code>
                </>
              ) : null}
            </div>
          </div>
          <div className="qrOfferActions">
            <button
              type="button"
              className="qrOfferBtn"
              onClick={() => {
                applyQrOffer(qrOffer);
                setQrOffer(null);
                setQrMode(false);
              }}
            >
              Session einlesen
            </button>
            <button
              type="button"
              className="qrOfferBtn ghost"
              onClick={() => {
                if (!sendSessionOffer) return;
                sendSessionOffer(
                  {
                    session: sessionId,
                    seed: sessionSeed,
                  },
                  qrOffer.session
                );
                setOfferStatus("Angebot gesendet");
                setQrStatus("Session-Angebot gesendet");
                setTimeout(() => {
                  setQrStatus("");
                  setOfferStatus("idle");
                }, 3000);
                setQrOffer(null);
                setQrMode(false);
              }}
            >
              Eigene Session senden
            </button>
          </div>
        </div>
      )}

      {incomingOffer && !isMobile && (
        <div className="legalModal" onClick={() => setIncomingOffer(null)}>
          <div
            className="legalModalCard"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="legalModalBody">
              <h3>Session wechseln?</h3>
              <p>
                {incomingOffer.from || "Peer"} bietet eine Session an:
                <br />
                <strong>{incomingOffer.session}</strong>
                {incomingOffer.seed ? (
                  <>
                    <br />
                    Seed: <code>{incomingOffer.seed}</code>
                  </>
                ) : null}
              </p>
              <div className="legalActions">
                <button type="button" className="legalClose" onClick={() => setIncomingOffer(null)}>
                  Ablehnen
                </button>
                <button
                  type="button"
                  className="legalClose"
                  onClick={() => {
                    applyQrOffer(incomingOffer);
                  }}
                >
                  Akzeptieren
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cameraReady && (
        <div className="qualityPickerWrap">
          <button
            type="button"
            className="qualityToggle"
            onClick={(e) => {
              e.stopPropagation();
              setShowQualityPicker((v) => !v);
            }}
          >
            Auflsung: {quality}
          </button>
          {showQualityPicker && (
            <div className="qualityMenu" onClick={(e) => e.stopPropagation()}>
              {[
                { id: "S", label: "S (360 x 640)" },
                { id: "M", label: "M (720 x 1280)" },
                { id: "L", label: "L (1080 x 1920)" },
                { id: "XL", label: "XL (1440 x 2560)" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`qualityItem ${quality === opt.id ? "active" : ""}`}
                  onClick={() => {
                    setQuality(opt.id);
                    setShowQualityPicker(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

