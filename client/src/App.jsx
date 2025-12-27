import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./App.css";
import { isMobileDevice } from "./utils/session";
import { useSessionSockets } from "./hooks/useSessionSockets";
import { useCameraCapture } from "./hooks/useCameraCapture";
import { useStatusMessage } from "./hooks/useStatusMessage";
import { useClipboardShare } from "./hooks/useClipboardShare";
import { useQrScanner } from "./hooks/useQrScanner";
import { decryptToDataUrl, encryptDataUrl, generateSeedBase64Url } from "./utils/crypto";
import { useEncryption } from "./hooks/useEncryption";
import { CookiesContent } from "./pages/CookiesPage";
import { PrivacyContent } from "./pages/PrivacyPage";
import { TermsContent } from "./pages/TermsPage";
import { ImpressumContent } from "./pages/ImpressumPage";
import { DesktopApp } from "./DesktopApp";
import { MobileApp } from "./MobileApp";

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
  const host = window.location.hostname || "";
  const isLocalHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local") ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.startsWith("172.16.") ||
    host.startsWith("172.17.") ||
    host.startsWith("172.18.") ||
    host.startsWith("172.19.") ||
    host.startsWith("172.2") ||
    host.startsWith("172.3");
  const allowDebug = isLocalHost && import.meta.env.VITE_LOCAL_DEBUG === "1";
  const [qrMode, setQrMode] = useState(false);
  const [qrStatus, setQrStatus] = useState("");
  const [qrOffer, setQrOffer] = useState(null);
  const [incomingOffer, setIncomingOffer] = useState(null);
  const [offerStatus, setOfferStatus] = useState("idle");
  const [mobileView, setMobileView] = useState("camera"); // camera | gallery
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

  const {
    clipboardPreview,
    setClipboardPreview,
    clipboardMode,
    copyImageToClipboard,
    copyPlainUrl,
    copyEncrypted,
    saveImage,
    handleDesktopClipboardLoad,
    handleDesktopClipboardSend,
    discardClipboardPreview,
  } = useClipboardShare({
    sessionKey,
    showCopyStatus,
    sendPhotoSecure,
    setLightboxSrc,
  });

  useQrScanner({
    enabled: qrMode,
    videoRef,
    onStart: () => {
      setQrStatus("QR-Scan aktiv");
      setQrOffer(null);
    },
    onStop: () => setQrStatus(""),
    onResult: (parsed) => {
      if (!parsed?.session) return;
      setQrStatus(`QR erkannt: ${parsed.session}`);
      setQrOffer(parsed);
      setQrMode(false);
      setTimeout(() => setQrStatus(""), 4000);
    },
  });

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
  }, [qrPanelRef, peerPanelRef, isMobile, peers.length, photos.length]);

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

  if (!isMobile) {
  return (
    <DesktopApp
      sessionId={sessionId}
      sessionSeed={sessionSeed}
      sessionKeyB64={sessionKeyB64}
      encStatus={encStatus}
      offerStatus={offerStatus}
      setOfferStatus={setOfferStatus}
      clientUuid={clientUuid}
      peers={peers}
    photos={photos}
    showDebug={allowDebug && showDebug}
    setShowDebug={allowDebug ? setShowDebug : undefined}
      debugDataUrl={debugDataUrl}
      setDebugDataUrl={setDebugDataUrl}
      injectDebugPhoto={injectDebugPhoto}
      copyStatus={allowDebug ? copyStatus : ""}
      qrStatus={qrStatus}
      handleSeedInput={handleSeedInput}
      applyQrOffer={applyQrOffer}
      incomingOffer={incomingOffer}
      setIncomingOffer={setIncomingOffer}
      copyImageToClipboard={copyImageToClipboard}
      saveImage={saveImage}
      copyPlainUrl={copyPlainUrl}
      copyEncrypted={copyEncrypted}
      handleDesktopFiles={handleDesktopFiles}
      desktopFileInputRef={desktopFileInputRef}
      handleDesktopClipboardLoad={handleDesktopClipboardLoad}
      clipboardPreview={clipboardPreview}
      handleDesktopClipboardSend={handleDesktopClipboardSend}
      setClipboardPreview={setClipboardPreview}
      clipboardMode={clipboardMode}
      discardClipboardPreview={discardClipboardPreview}
      lightboxSrc={lightboxSrc}
      setLightboxSrc={setLightboxSrc}
      qrPanelRef={qrPanelRef}
      peerPanelRef={peerPanelRef}
      panelHeights={panelHeights}
    legalOpen={legalOpen}
    legalContent={legalContent}
    navigate={navigate}
    allowDebug={allowDebug}
  />
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
    <MobileApp
      sessionId={sessionId}
      sessionSeed={sessionSeed}
      sessionKeyB64={sessionKeyB64}
      encStatus={encStatus}
      offerStatus={allowDebug ? offerStatus : ""}
      qrStatus={qrStatus}
      handleSeedInput={handleSeedInput}
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
      qrOffer={qrOffer}
      setQrOffer={setQrOffer}
      quality={quality}
      setQuality={setQuality}
      showQualityPicker={showQualityPicker}
      setShowQualityPicker={setShowQualityPicker}
      mobileView={mobileView}
      setMobileView={setMobileView}
      handleTouchStart={handleTouchStart}
      handleTouchEnd={handleTouchEnd}
      sendSessionOffer={sendSessionOffer}
      setOfferStatus={setOfferStatus}
      setQrStatus={setQrStatus}
      applyQrOffer={applyQrOffer}
      incomingOffer={incomingOffer}
      setIncomingOffer={setIncomingOffer}
      photos={photos}
      setLightboxSrc={setLightboxSrc}
      copyImageToClipboard={copyImageToClipboard}
      saveImage={saveImage}
      copyPlainUrl={copyPlainUrl}
      copyEncrypted={copyEncrypted}
    />
  );
}
