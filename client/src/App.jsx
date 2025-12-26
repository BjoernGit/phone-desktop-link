import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./App.css";
import { isMobileDevice } from "./utils/session";
import { toBlob } from "./utils/image";
import { useSessionSockets } from "./hooks/useSessionSockets";
import { useCameraCapture } from "./hooks/useCameraCapture";
import { useStatusMessage } from "./hooks/useStatusMessage";
import jsQR from "jsqr";
import { QrPanel } from "./components/QrPanel";
import { PhotoGrid } from "./components/PhotoGrid";
import { Lightbox } from "./components/Lightbox";
import { DebugPanel } from "./components/DebugPanel";
import { FooterBar } from "./components/FooterBar";
import { SessionOfferBar } from "./components/SessionOfferBar";
import { SessionOfferModal } from "./components/SessionOfferModal";
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
  const { message: copyStatus, show: showCopyStatus } = useStatusMessage();
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
  const [mobileView, setMobileView] = useState("camera"); // camera | gallery
  const [clipboardPreview, setClipboardPreview] = useState(null);
  const [clipboardMode, setClipboardMode] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const qrPanelRef = useRef(null);
  const peerPanelRef = useRef(null);
  const desktopFileInputRef = useRef(null);
  const touchStartRef = useRef(null);

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
    const onResize = () => setIsMobile(isMobileDevice());
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleTouchStart = useCallback((e) => {
    const t = e.changedTouches?.[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }, []);

  const handleTouchEnd = useCallback(
    (e) => {
      const start = touchStartRef.current;
      const t = e.changedTouches?.[0];
      touchStartRef.current = null;
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return; // nur klare horizontale Swipes
      if (dx < -40) {
        setMobileView("gallery");
      } else if (dx > 40) {
        setMobileView("camera");
      }
    },
    []
  );

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
      if (payload?.imageDataUrl) {
        setEncStatus("plain-ok");
        return payload.imageDataUrl;
      }
      return null;
    },
    [] // key is taken from ref; setEncStatus is stable
  );

  const {
    sessionId,
    clientUuid,
    peers,
    photos,
    sendPhoto,
    addLocalPhoto,
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

  const { sessionKey, sessionKeyB64, applySeed, clearKey } = useEncryption(sessionId, setEncStatus);

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
      if (offer.targetUuid) params.set("uid", offer.targetUuid);
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
        showCopyStatus("Kein Key - Foto nicht gesendet");
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
    [sendPhoto, sessionId, sessionKey, showCopyStatus]
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
        const targetUuid = url.searchParams.get("uid") || "";
        const seed = url.hash ? new URLSearchParams(url.hash.replace(/^#/, "")).get("seed") || "" : "";
        return { session, seed, targetUuid, raw };
      } catch {
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
        if (parsed.session) {
          setQrStatus(`QR erkannt: ${parsed.session}`);
          setQrOffer(parsed);
          setQrMode(false);
          setTimeout(() => setQrStatus(""), 4000);
          return;
        }
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
        clearKey();
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
  }, [applySeedAndStore, clearKey, isMobile, seedInitialized, sessionId, sessionSeed]);

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
          showCopyStatus(`${label} kopiert`);
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
      showCopyStatus(
        supportsImageClipboard
          ? "Link kopiert (Bild-Clipboard blockiert)"
          : "Link kopiert (Bild-Clipboard nicht untersttzt)"
      );
    } catch {
      showCopyStatus("Kopieren nicht mglich");
    }
  }

  async function copyPlainUrl(src) {
    try {
      await navigator.clipboard.writeText(src);
      showCopyStatus("Data-URL kopiert");
    } catch (e) {
      console.warn("Plain copy failed", e);
      showCopyStatus("Kopieren nicht mglich");
    }
  }

  async function copyEncrypted(src) {
    if (!sessionKey) {
      showCopyStatus("Kein Key - verschlsselt nicht kopiert");
      return;
    }
    try {
      const payload = await encryptDataUrl(src, sessionKey);
      await navigator.clipboard.writeText(JSON.stringify(payload));
      showCopyStatus("Verschlsselt kopiert");
    } catch (e) {
      console.warn("Encrypted copy failed", e);
      showCopyStatus("Verschlsseltes Kopieren fehlgeschlagen");
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
      showCopyStatus("Speichern nicht mglich");
    }
  }

  async function injectDebugPhoto() {
    if (!debugDataUrl.trim()) return;
    const src = debugDataUrl.trim();

    try {
      const parsed = JSON.parse(src);
      if (parsed?.ciphertext) {
        if (!sessionKey) {
          showCopyStatus("Kein Key zum Entschlsseln");
          return;
        }
        try {
          const decrypted = await decryptToDataUrl(parsed, sessionKey);
          addLocalPhoto(decrypted);
          showCopyStatus("Entschlsselt importiert");
        } catch (e) {
          console.warn("Decrypt debug import failed", e);
          showCopyStatus("Decrypt fehlgeschlagen");
        }
        setDebugDataUrl("");
        return;
      }
    } catch {
      // Not JSON, fall through
    }

    const looksOkay = src.startsWith("data:image") || src.startsWith("http://") || src.startsWith("https://");
    if (!looksOkay) {
      showCopyStatus("Ungltige Quelle", 1200);
      return;
    }
    addLocalPhoto(src);
    setDebugDataUrl("");
  }

  const fileToDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleDesktopFiles = useCallback(
    async (fileList) => {
      if (!fileList || !fileList.length) return;
      for (const file of Array.from(fileList)) {
        try {
          if (!file?.type?.startsWith("image/")) continue;
          const dataUrl = await fileToDataUrl(file);
          if (dataUrl) {
            await sendPhotoSecure(dataUrl);
          }
        } catch (e) {
          console.warn("Desktop upload failed", e);
          showCopyStatus("Upload fehlgeschlagen");
        }
      }
    },
    [sendPhotoSecure, showCopyStatus]
  );

  const handleDesktopClipboardLoad = useCallback(async () => {
    try {
      let found = false;
      // Erst versuchen, echte Image-Items zu lesen
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find((t) => t.startsWith("image/"));
          if (imgType) {
            const blob = await item.getType(imgType);
            const dataUrl = await fileToDataUrl(blob);
            if (dataUrl) {
              setClipboardPreview({ type: "image", data: dataUrl });
              setLightboxSrc(dataUrl);
              setClipboardMode(true);
              showCopyStatus("Clipboard geladen", 1200);
              found = true;
              break;
            }
          }
        }
      }
      // Fallback: Text
      if (!found) {
        const txt = await navigator.clipboard.readText();
        if (txt && (txt.startsWith("data:image") || txt.startsWith("http"))) {
          setClipboardPreview({ type: "text", data: txt });
          showCopyStatus("Clipboard geladen", 1200);
          found = true;
        }
      }
      if (!found) {
        showCopyStatus("Keine Bilddaten im Clipboard");
      }
    } catch (e) {
      console.warn("Clipboard read failed", e);
      showCopyStatus("Clipboard nicht lesbar");
    }
  }, [showCopyStatus]);

  const handleDesktopClipboardSend = useCallback(async () => {
    if (!clipboardPreview) return;
    try {
      await sendPhotoSecure(clipboardPreview.data);
      showCopyStatus("Clipboard-Bild gesendet", 1200);
      setClipboardPreview(null);
      setClipboardMode(false);
      setLightboxSrc(null);
    } catch (e) {
      console.warn("Clipboard send failed", e);
      showCopyStatus("Senden fehlgeschlagen");
    }
  }, [clipboardPreview, sendPhotoSecure, showCopyStatus]);

  const discardClipboardPreview = useCallback(() => {
    setClipboardPreview(null);
    setClipboardMode(false);
    setLightboxSrc(null);
  }, []);

  if (!isMobile) {
    const buildUrl = () => {
      if (!sessionId) return window.location.href;
      const params = new URLSearchParams(window.location.search);
      params.delete("key");
      params.set("session", sessionId);
      if (clientUuid) params.set("uid", clientUuid);
      const hash = sessionSeed ? `#seed=${sessionSeed}` : "";
      return `${window.location.origin}${window.location.pathname}?${params.toString()}${hash}`;
    };

    const url = buildUrl();
    const qrBaseSize = 240;
    const qrSize = hasActiveUI ? qrBaseSize * 0.8 : qrBaseSize;
    const uploadPanel = (
      <div>
        <h3>Fotos hinzufügen</h3>
        <div className="uploadActions">
          <button type="button" onClick={() => desktopFileInputRef.current?.click()}>
            Bild hochladen
          </button>
          <button type="button" onClick={handleDesktopClipboardLoad}>
            Clipboard laden
          </button>
        </div>
        <input
          ref={desktopFileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            handleDesktopFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {clipboardPreview && (
          <div className="clipboardPreview">
            <div className="clipboardLabel">Clipboard-Vorschau</div>
            {clipboardPreview.type === "image" ? (
              <img src={clipboardPreview.data} alt="Clipboard preview" className="clipboardThumb" />
            ) : (
              <code className="clipboardText">{clipboardPreview.data.slice(0, 120)}</code>
            )}
            <div className="uploadActions">
              <button type="button" onClick={handleDesktopClipboardSend}>
                Vorschau senden
              </button>
              <button type="button" onClick={() => setClipboardPreview(null)}>
                Verwerfen
              </button>
            </div>
          </div>
        )}
        <p className="mutedText">Bilder werden innerhalb dieser Session geteilt.</p>
      </div>
    );

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
                    uploadPanel={uploadPanel}
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
            onClose={clipboardMode ? discardClipboardPreview : () => setLightboxSrc(null)}
            onCopy={copyImageToClipboard}
            onSave={saveImage}
            showDebug={showDebug}
            onCopyPlain={copyPlainUrl}
            onCopyEncrypted={copyEncrypted}
            actions={
              clipboardMode ? (
                <>
                  <button
                    type="button"
                    className="overlayBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDesktopClipboardSend();
                    }}
                  >
                    Senden
                  </button>
                  <button
                    type="button"
                    className="overlayBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      discardClipboardPreview();
                    }}
                  >
                    Verwerfen
                  </button>
                </>
              ) : undefined
            }
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
      <div className="mobileSimpleRoot" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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
    <div className="mobileSimpleRoot" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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
        hidden={mobileView !== "camera"}
      />

      {mobileView === "camera" ? (
        <>
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
                  qrOffer.session,
                  qrOffer.targetUuid
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

          <SessionOfferModal
            offer={isMobile ? incomingOffer : null}
            onDecline={() => setIncomingOffer(null)}
            onAccept={() => {
              applyQrOffer(incomingOffer);
            }}
          />
        </>
      ) : (
        <div className="mobileGalleryView" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          <div className="mobileGalleryPlaceholder">
            <h2>Galerie (Mobil)</h2>
            <button
              type="button"
              className="mobileBackBtn"
              onClick={() => setMobileView("camera")}
            >
              Zurück zur Kamera
            </button>
            {photos.length === 0 ? (
              <>
                <p>Noch keine Fotos in dieser Session.</p>
                <p>Swipe nach rechts zurück zur Kamera.</p>
              </>
            ) : (
              <div className="mobileGalleryGrid">
                <PhotoGrid
                  photos={photos}
                  onSelect={setLightboxSrc}
                  onCopy={copyImageToClipboard}
                  onSave={saveImage}
                  showDebug={false}
                  onCopyPlain={copyPlainUrl}
                  onCopyEncrypted={copyEncrypted}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}



