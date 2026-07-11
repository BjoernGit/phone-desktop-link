import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./App.css";
import { isMobileDevice } from "./utils/session";
import { useSessionSockets } from "./hooks/useSessionSockets";
import { useCameraCapture } from "./hooks/useCameraCapture";
import { useStatusMessage } from "./hooks/useStatusMessage";
import { useClipboardShare } from "./hooks/useClipboardShare";
import { useAutoQrDetection } from "./hooks/useAutoQrDetection";
import { useAppFileTransfer } from "./hooks/useAppFileTransfer";
import { useAppTouchGestures } from "./hooks/useAppTouchGestures";
import { decryptJsonWithSecret, decryptToDataUrl, encryptDataUrl, generateSeedBase64Url } from "./utils/crypto";
import { useEncryption } from "./hooks/useEncryption";
import { CookiesContent } from "./pages/CookiesPage";
import { PrivacyContent } from "./pages/PrivacyPage";
import { TermsContent } from "./pages/TermsPage";
import { ImpressumContent } from "./pages/ImpressumPage";
import { DesktopApp } from "./DesktopApp";
import { MobileApp } from "./MobileApp";
import { isLocalNetwork } from "./config/network";
import { QR_TTL_MS, STATUS_DISMISS_MS, SESSION_STATUS_DISMISS_MS } from "./config/security";
import { FEATURE_FLAGS } from "./config/features";

const QR_AUTO_CLOSE_SECONDS = 5;

export default function App() {
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(() => isMobileDevice());
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const { message: copyStatus, show: showCopyStatus } = useStatusMessage();
  const [debugDataUrl, setDebugDataUrl] = useState("");
  const host = window.location.hostname || "";
  const isLocalHost = isLocalNetwork(host);
  const allowDebug = isLocalHost && import.meta.env.VITE_LOCAL_DEBUG === "1";
  const forceDebugVisible = import.meta.env.VITE_FORCE_LOCAL_DEBUG_VISIBLE === "1";
  const [showDebug, setShowDebug] = useState(allowDebug && forceDebugVisible); // Auto-show if debug enabled and forced visible
  const [panelHeights, setPanelHeights] = useState({ qr: 0, peer: 0 });
  const [sessionSeed, setSessionSeed] = useState("");
  const [offerSecret, setOfferSecret] = useState("");
  const [encStatus, setEncStatus] = useState("idle");
  const [seedInitialized, setSeedInitialized] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const fileInputRef = useRef(null);
  const sessionKeyRef = useRef(null);
  const [peerStatuses, setPeerStatuses] = useState({});
  const [qrStatus, setQrStatus] = useState("");
  const [qrOffer, setQrOffer] = useState(null);
  const [showQrDialog, setShowQrDialog] = useState(false);
  const [qrCountdown, setQrCountdown] = useState(0);
  const [incomingOffer, setIncomingOffer] = useState(null);
  const [offerStatus, setOfferStatus] = useState("idle");
  const location = useLocation();
  const navigate = useNavigate();

  // Initialize mobileView based on whether we have a session
  const initialMobileView = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const hasSession = params.has("session");
    return hasSession ? "camera" : "qrDisplay";
  }, []);
  const [mobileView, setMobileView] = useState(initialMobileView);

  const qrPanelRef = useRef(null);
  const peerPanelRef = useRef(null);
  const desktopFileInputRef = useRef(null);
  const peerFileListHandlerRef = useRef(null); // Will be set by useAppFileTransfer

  // Touch gestures for mobile view navigation
  const { handleTouchStart, handleTouchEnd } = useAppTouchGestures(mobileView, setMobileView);

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
    return t("common.deviceName.unknown");
  }, [t]);

  useEffect(() => {
    const onResize = () => setIsMobile(isMobileDevice());
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
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
      if (payload?.imageDataUrl) {
        setEncStatus("plain-ok");
        return payload.imageDataUrl;
      }
      return null;
    },
    [] // key is taken from ref; setEncStatus is stable
  );

  // State for merge redirect modal (when AUTO_ACCEPT_SESSION_MERGES is false)
  const [mergeRequest, setMergeRequest] = useState(null);

  const {
    socket,
    sessionId,
    clientUuid,
    peers,
    photos,
    sendPhoto,
    addLocalPhoto,
    sendSessionOffer,
    sendSessionMerge,
    setSessionId: overrideSessionId,
    sendPeerDecision,
  } = useSessionSockets({
    isMobile,
    deviceName,
    offerSecret,
    onDecryptPhoto: decryptPhoto,
    onMergeRedirect: (payload) => {
      console.log("[DEBUG] onMergeRedirect called", { toSession: payload?.toSession, initiatorDevice: payload?.initiatorDevice });
      const { toSession, toSeed, toOfferSecret, initiatorDevice } = payload;

      // Auto-accept if flag is enabled
      if (FEATURE_FLAGS.AUTO_ACCEPT_SESSION_MERGES) {
        console.log("[DEBUG] Auto-accept merge redirect enabled");
        // Dispatch event to apply the merge (same pattern as session offers)
        window.dispatchEvent(
          new CustomEvent("auto-accept-offer", {
            detail: {
              session: toSession,
              seed: toSeed,
              offerSecret: toOfferSecret,
              from: initiatorDevice || "Peer",
              isMergeRedirect: true,
            },
          })
        );
      } else {
        // Show modal for manual accept/decline
        console.log("[DEBUG] Manual merge accept mode, setting mergeRequest");
        setMergeRequest({
          toSession,
          toSeed,
          toOfferSecret,
          initiatorDevice,
        });
      }
    },
    onSessionOffer: (payload) => {
      console.log("[DEBUG] onSessionOffer called", { hasEnc: !!payload?.enc, from: payload?.fromDevice });
      if (!payload?.enc) {
        console.log("[DEBUG] No enc in payload, returning early");
        return;
      }
      const doDecrypt = async () => {
        try {
          console.log("[DEBUG] Attempting offer decrypt");
          const plain = await decryptJsonWithSecret(offerSecret, payload.enc, "offer-share");
          console.log("[DEBUG] Decrypt ok, session:", plain?.session);
          if (!plain?.session || !plain?.seed) {
            setOfferStatus(t("status.offerIncomplete"));
            return;
          }
          setOfferStatus(t("status.offerReceived"));

          const offer = {
            session: plain.session,
            seed: plain.seed || "",
            offerSecret: plain.offerSecret || offerSecret,
            from: payload.fromDevice || payload.fromRole || "Peer",
            fromUuid: payload.fromUuid || "",
          };

          console.log("[DEBUG] Created offer object", { session: offer.session, from: offer.from });
          console.log("[DEBUG] AUTO_ACCEPT_SESSION_OFFERS flag:", FEATURE_FLAGS.AUTO_ACCEPT_SESSION_OFFERS);

          // Auto-accept if flag is enabled
          if (FEATURE_FLAGS.AUTO_ACCEPT_SESSION_OFFERS) {
            console.log("[DEBUG] Auto-accept enabled, dispatching event with offer data");
            // Use applyQrOffer which handles all the session switching logic
            // Pass offer data through the event to avoid race condition with state
            window.dispatchEvent(new CustomEvent("auto-accept-offer", { detail: offer }));
          } else {
            // Show modal for manual accept/decline
            console.log("[DEBUG] Manual accept mode, setting incomingOffer for modal");
            setIncomingOffer(offer);
          }
        } catch (e) {
          console.warn("Offer decrypt failed", e);
          setOfferStatus(t("status.offerUnreadable"));
        }
      };
      doDecrypt();
    },
    onPeerStatus: (payload) => {
      if (!payload?.clientUuid || !payload?.status) return;
      setPeerStatuses((prev) => {
        const next = { ...prev };
        if (payload.status === "left") {
          delete next[payload.clientUuid];
        } else {
          next[payload.clientUuid] = payload.status;
        }
        return next;
      });
    },
    onPeerFileList: (payload) => {
      // Forward to the handler from useAppFileTransfer via ref
      peerFileListHandlerRef.current?.(payload);
    },
  });

  // File Transfer (WebRTC + Socket.io fallback)
  const {
    sharedFiles,
    peerFiles,
    handleFileDownload,
    handleSharedFilesChange,
    handleRemoveFile,
    handlePeerFileList,
    syncFilesToPeer,
    fileTransfers,
    webRTCConnections,
    alertMessage,
    clearAlert,
    directConnectionPrompt,
    acceptDirectConnection,
    declineDirectConnection,
  } = useAppFileTransfer({
    socket,
    clientUuid,
    peers,
    // The boost modal only exists on desktop; mobile has camera permission anyway
    directConnectionPromptEnabled: !isMobile,
  });

  // Set the ref so useSessionSockets can forward peer-file-list events
  peerFileListHandlerRef.current = handlePeerFileList;

  // Track recently approved peers (late joiners who may need file sync)
  const [recentlyApprovedPeers, setRecentlyApprovedPeers] = useState(new Set());

  const approvePeer = useCallback(
    (uuid) => {
      sendPeerDecision(uuid, "approve");
      // Add to recently approved set so sync button appears (only if manual sync enabled)
      if (FEATURE_FLAGS.MANUAL_FILE_SYNC) {
        setRecentlyApprovedPeers((prev) => new Set([...prev, uuid]));
      }
    },
    [sendPeerDecision]
  );

  const rejectPeer = useCallback(
    (uuid) => {
      sendPeerDecision(uuid, "reject");
    },
    [sendPeerDecision]
  );

  // Auto-sync files when peers become approved (if manual sync is disabled)
  useEffect(() => {
    if (FEATURE_FLAGS.MANUAL_FILE_SYNC || !syncFilesToPeer) return;

    const approvedPeers = Object.entries(peerStatuses)
      .filter(([_, status]) => status === "approved")
      .map(([uuid]) => uuid);

    approvedPeers.forEach((peerUuid) => {
      // Check if this is a newly approved peer we haven't synced yet
      const peer = peers.find((p) => p.clientUuid === peerUuid);
      if (peer && sharedFiles.length > 0) {
        console.log(`[App] Auto-syncing files to approved peer ${peerUuid}`);
        syncFilesToPeer(peerUuid).catch((err) => {
          console.error(`[App] Auto-sync failed for peer ${peerUuid}:`, err);
        });
      }
    });
  }, [peerStatuses, syncFilesToPeer, peers, sharedFiles.length]);

  // Handle content sync to a late joiner (files metadata only for now)
  const handleSyncFiles = useCallback(
    async (peerUuid) => {
      console.log(`[App] Starting file metadata sync to peer ${peerUuid}`);
      try {
        // Sync file metadata list (re-broadcast)
        // This only syncs the file list, NOT the actual files
        // Late joiners can then download files they want on-demand
        await syncFilesToPeer(peerUuid);

        console.log(`[App] File metadata sync completed for peer ${peerUuid}`);
        // Remove from recently approved after sync
        setRecentlyApprovedPeers((prev) => {
          const next = new Set(prev);
          next.delete(peerUuid);
          return next;
        });
      } catch (error) {
        console.error(`[App] File metadata sync failed for peer ${peerUuid}:`, error);
      }
    },
    [syncFilesToPeer]
  );

  // Combine all files for display (own + peer files)
  const allFiles = useMemo(() => {
    const combined = [];

    // Add own files
    sharedFiles.forEach((file) => {
      combined.push({
        ...file,
        ownerUuid: clientUuid,
      });
    });

    // Add peer files (excluding our own broadcasts)
    peerFiles.forEach((fileList, peerUuid) => {
      if (peerUuid === clientUuid) return;
      fileList.forEach((file) => {
        combined.push(file);
      });
    });

    return combined;
  }, [sharedFiles, peerFiles, clientUuid]);

  const { sessionKey, sessionKeyB64, applySeed, clearKey } = useEncryption(sessionId, setEncStatus);

  useEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  const applySeedAndStore = useCallback(
    async (seed, sessionOverride) => {
      setSessionSeed(seed);
      await applySeed(seed, sessionOverride);
      if (window.location.hash) {
        const search = window.location.search || "";
        window.history.replaceState({}, "", `${window.location.pathname}${search}`);
      }
    },
    [applySeed]
  );

  const applyQrOffer = useCallback(
    (offer) => {
      console.log("[DEBUG] applyQrOffer called", { session: offer?.session, hasSeed: !!offer?.seed });
      if (!offer?.session) {
        console.log("[DEBUG] applyQrOffer: no session in offer");
        setQrStatus(t("status.noSession"));
        return;
      }

      // Validate QR code TTL
      if (offer.timestamp) {
        const age = Date.now() - Number(offer.timestamp);
        console.log("[DEBUG] applyQrOffer: checking TTL, age:", age, "max:", QR_TTL_MS);
        if (age > QR_TTL_MS) {
          setQrStatus(t("status.qrExpired"));
          setTimeout(() => setQrStatus(""), STATUS_DISMISS_MS);
          return;
        }
      }

      console.log("[DEBUG] applyQrOffer: applying session", offer.session);
      const params = new URLSearchParams(window.location.search);
      params.set("session", offer.session);
      if (offer.targetUuid) params.set("uid", offer.targetUuid);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      console.log("[DEBUG] applyQrOffer: updating URL to", newUrl);
      window.history.replaceState({}, "", newUrl);
      console.log("[DEBUG] applyQrOffer: calling overrideSessionId");
      overrideSessionId?.(offer.session);
      if (offer.offerSecret) {
        console.log("[DEBUG] applyQrOffer: setting offerSecret");
        setOfferSecret(offer.offerSecret);
      }
      if (offer.seed) {
        console.log("[DEBUG] applyQrOffer: applying seed");
        applySeedAndStore(offer.seed, offer.session);
      }
      setQrStatus(t("status.sessionTaken"));
      setTimeout(() => setQrStatus(""), SESSION_STATUS_DISMISS_MS);
      console.log("[DEBUG] applyQrOffer: completed");
    },
    [applySeedAndStore, overrideSessionId, t]
  );

  // Auto-accept incoming offers and merge redirects when their respective flags are enabled
  // This listener handles both session-offers (AUTO_ACCEPT_SESSION_OFFERS) and
  // merge-redirects (AUTO_ACCEPT_SESSION_MERGES) via the same event mechanism
  useEffect(() => {
    const handleAutoAccept = (event) => {
      const offer = event.detail;
      console.log("[DEBUG] handleAutoAccept received event", { session: offer?.session, isMergeRedirect: !!offer?.isMergeRedirect });
      if (offer) {
        console.log("[DEBUG] Calling applyQrOffer with offer, isMergeRedirect:", offer.isMergeRedirect);
        applyQrOffer(offer);
        // Show appropriate status message
        if (offer.isMergeRedirect) {
          setQrStatus(t("status.sessionMerged"));
          setTimeout(() => setQrStatus(""), SESSION_STATUS_DISMISS_MS);
        } else {
          setOfferStatus(t("status.offerAccepted"));
          setTimeout(() => setOfferStatus(""), SESSION_STATUS_DISMISS_MS);
        }
      } else {
        console.log("[DEBUG] No offer in event detail");
      }
    };

    window.addEventListener("auto-accept-offer", handleAutoAccept);
    return () => window.removeEventListener("auto-accept-offer", handleAutoAccept);
  }, [applyQrOffer, t]);

  const sendPhotoSecure = useCallback(
    async (imageDataUrl) => {
      if (!sessionId || !imageDataUrl) return;
      if (!sessionKey) {
        setEncStatus("no-key");
        showCopyStatus(t("errors.noKey"));
        return;
      }
      if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
        showCopyStatus(t("errors.onlyImageDataUrls"));
        return;
      }
      if (/^data:image\/svg\+xml/i.test(imageDataUrl)) {
        showCopyStatus(t("errors.svgNotSent"));
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
    [sendPhoto, sessionId, sessionKey, showCopyStatus, t]
  );

  const {
    videoRef,
    cameraReady,
    cameraError,
    isStartingCamera,
    previewRotation,
    handleStartCamera,
    handleShutter,
    quality,
    setQuality,
    handleFiles,
  } = useCameraCapture({
    sessionId,
    onSendPhoto: sendPhotoSecure,
    t,
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
    t,
  });

  // Automatic low-res QR detection (runs continuously when camera is ready)
  useAutoQrDetection({
    videoRef,
    enabled: isMobile && cameraReady,
    onDetected: (parsed) => {
      if (parsed?.session) {
        setQrOffer(parsed);
        setQrCountdown(QR_AUTO_CLOSE_SECONDS);
        setShowQrDialog(true);
      }
    },
    onLost: () => {
      setQrOffer(null);
      setShowQrDialog(false);
      setQrCountdown(0);
    },
    scanInterval: 10, // Scan every 10 frames
  });

  useEffect(() => {
    if (!showQrDialog || !qrOffer?.session) {
      setQrCountdown(0);
      return;
    }

    let remaining = QR_AUTO_CLOSE_SECONDS;
    setQrCountdown(remaining);

    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(timer);
        setQrCountdown(0);
        setShowQrDialog(false);
        setQrOffer(null);
        return;
      }
      setQrCountdown(remaining);
    }, 1000);

    return () => clearInterval(timer);
  }, [showQrDialog, qrOffer?.session]);

  const pendingPeers = useMemo(
    () =>
      Object.entries(peerStatuses)
        .filter(([uuid, status]) => status === "pending" && uuid !== clientUuid)
        .map(([uuid]) => uuid),
    [clientUuid, peerStatuses]
  );

  // Check if current user is waiting for approval
  const isWaitingForApproval = useMemo(
    () => clientUuid && peerStatuses[clientUuid] === "pending",
    [clientUuid, peerStatuses]
  );
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
    const offerSecretFromHash = hashParams.get("ok") || "";

    const setup = async () => {
      if (!window.isSecureContext || !crypto?.subtle) {
        console.warn("WebCrypto not available, falling back to unencrypted mode");
        clearKey();
        setSeedInitialized(true);
        return;
      }

      // Both mobile and desktop should generate a seed if none exists
      // Mobile needs its own seed to be able to "send own session" after a reload
      const seed = sessionSeed || seedFromHash || generateSeedBase64Url(16);
      const secret = offerSecret || offerSecretFromHash || generateSeedBase64Url(24);
      if (!seed) {
        setEncStatus("no-seed");
        setSeedInitialized(true);
        return;
      }

      await applySeedAndStore(seed);
      setOfferSecret(secret);
      setSeedInitialized(true);
    };

    setup();
  }, [applySeedAndStore, clearKey, isMobile, offerSecret, seedInitialized, sessionId, sessionSeed]);

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
          showCopyStatus(t("errors.noKeyToDecrypt"));
          return;
        }
        try {
          const decrypted = await decryptToDataUrl(parsed, sessionKey);
          addLocalPhoto(decrypted);
          showCopyStatus(t("clipboard.decryptedImported"));
        } catch (e) {
          console.warn("Decrypt debug import failed", e);
          showCopyStatus(t("errors.decryptFailed"));
        }
        setDebugDataUrl("");
        return;
      }
    } catch {
      // Not JSON, fall through
    }

    const looksOkay = src.startsWith("data:image") || src.startsWith("http://") || src.startsWith("https://");
    if (!looksOkay) {
      showCopyStatus(t("errors.invalidSource"), 1200);
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
          showCopyStatus(t("errors.uploadFailed"));
        }
      }
    },
    [sendPhotoSecure, showCopyStatus, t]
  );

  // Generate QR code URL for both mobile and desktop with TTL
  const qrUrl = useMemo(() => {
    if (!sessionId) return window.location.href;
    const params = new URLSearchParams(window.location.search);
    params.delete("key");
    params.set("session", sessionId);
    if (clientUuid) params.set("uid", clientUuid);
    const hashParams = new URLSearchParams();
    if (sessionSeed) hashParams.set("seed", sessionSeed);
    if (offerSecret) hashParams.set("ok", offerSecret);
    // Add timestamp for TTL validation (10 minutes)
    hashParams.set("t", Date.now().toString());
    const hash = hashParams.toString();
    return `${window.location.origin}${window.location.pathname}?${params.toString()}${hash ? `#${hash}` : ""}`;
  }, [clientUuid, offerSecret, sessionId, sessionSeed]);

  if (!isMobile) {
  return (
    <DesktopApp
      sessionId={sessionId}
    sessionSeed={sessionSeed}
    offerSecret={offerSecret}
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
      pendingPeers={pendingPeers}
      approvePeer={approvePeer}
      rejectPeer={rejectPeer}
      recentlyApprovedPeers={Array.from(recentlyApprovedPeers)}
      onSyncFiles={handleSyncFiles}
      sharedFiles={sharedFiles}
      onSharedFilesChange={handleSharedFilesChange}
      allFiles={allFiles}
      onFileDownload={handleFileDownload}
      onRemoveFile={handleRemoveFile}
      fileTransfers={fileTransfers}
      webRTCConnections={webRTCConnections}
      alertMessage={alertMessage}
      clearAlert={clearAlert}
      directConnectionPrompt={directConnectionPrompt}
      acceptDirectConnection={acceptDirectConnection}
      declineDirectConnection={declineDirectConnection}
    />
);
  }

  return (
    <MobileApp
      sessionId={sessionId}
      sessionSeed={sessionSeed}
      offerSecret={offerSecret}
      sessionKeyB64={sessionKeyB64}
      encStatus={encStatus}
      offerStatus={allowDebug ? offerStatus : ""}
      qrStatus={qrStatus}
      allowDebug={allowDebug}
      handleSeedInput={handleSeedInput}
      videoRef={videoRef}
      cameraReady={cameraReady}
      cameraError={cameraError}
      isStartingCamera={isStartingCamera}
      previewRotation={previewRotation}
      handleStartCamera={handleStartCamera}
      handleShutter={handleShutter}
      fileInputRef={fileInputRef}
      handleFiles={handleFiles}
      showQrDialog={showQrDialog}
      setShowQrDialog={setShowQrDialog}
      qrCountdown={qrCountdown}
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
      sendSessionMerge={sendSessionMerge}
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
      pendingPeers={pendingPeers}
      approvePeer={approvePeer}
      rejectPeer={rejectPeer}
      isWaitingForApproval={isWaitingForApproval}
      clientUuid={clientUuid}
      qrUrl={qrUrl}
      peers={peers}
      allFiles={allFiles}
      sharedFiles={sharedFiles}
      handleFileDownload={handleFileDownload}
      handleRemoveFile={handleRemoveFile}
      handleSharedFilesChange={handleSharedFilesChange}
      fileTransfers={fileTransfers}
    />
  );
}
