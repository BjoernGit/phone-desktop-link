import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./App.css";
import { isMobileDevice } from "./utils/session";
import { useSessionSockets } from "./hooks/useSessionSockets";
import { useCameraCapture } from "./hooks/useCameraCapture";
import { useStatusMessage } from "./hooks/useStatusMessage";
import { useClipboardShare } from "./hooks/useClipboardShare";
import { useQrScanner } from "./hooks/useQrScanner";
import { useWebRTC } from "./hooks/useWebRTC";
import { useFileTransfer } from "./hooks/useFileTransfer";
import { decryptJsonWithSecret, decryptToDataUrl, encryptDataUrl, generateSeedBase64Url } from "./utils/crypto";
import { useEncryption } from "./hooks/useEncryption";
import { CookiesContent } from "./pages/CookiesPage";
import { PrivacyContent } from "./pages/PrivacyPage";
import { TermsContent } from "./pages/TermsPage";
import { ImpressumContent } from "./pages/ImpressumPage";
import { DesktopApp } from "./DesktopApp";
import { MobileApp } from "./MobileApp";

export default function App() {
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(() => isMobileDevice());
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const { message: copyStatus, show: showCopyStatus } = useStatusMessage();
  const [debugDataUrl, setDebugDataUrl] = useState("");
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
  const [showDebug, setShowDebug] = useState(allowDebug); // Auto-show if debug enabled
  const [panelHeights, setPanelHeights] = useState({ qr: 0, peer: 0 });
  const [sessionSeed, setSessionSeed] = useState("");
  const [offerSecret, setOfferSecret] = useState("");
  const [encStatus, setEncStatus] = useState("idle");
  const [seedInitialized, setSeedInitialized] = useState(false);
  const [showQualityPicker, setShowQualityPicker] = useState(false);
  const fileInputRef = useRef(null);
  const sessionKeyRef = useRef(null);
  const [peerStatuses, setPeerStatuses] = useState({});
  const [qrMode, setQrMode] = useState(false);
  const [qrStatus, setQrStatus] = useState("");
  const [qrOffer, setQrOffer] = useState(null);
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
    return t("common.deviceName.unknown");
  }, [t]);

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

      // Circular navigation: qrDisplay ← camera → gallery (and wraps around)
      // Layout: [gallery] → [qrDisplay] ← [camera] → [gallery] (infinite loop)
      if (dx < -40) {
        // Swipe left (finger moves left, content moves right)
        if (mobileView === "camera") setMobileView("gallery");
        else if (mobileView === "gallery") setMobileView("qrDisplay");
        else if (mobileView === "qrDisplay") setMobileView("camera");
      } else if (dx > 40) {
        // Swipe right (finger moves right, content moves left)
        if (mobileView === "camera") setMobileView("qrDisplay");
        else if (mobileView === "qrDisplay") setMobileView("gallery");
        else if (mobileView === "gallery") setMobileView("camera");
      }
    },
    [mobileView]
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

  // Callback for peer file list updates
  const handlePeerFileList = useCallback(({ fromUuid, files }) => {
    setPeerFiles((prev) => {
      const next = new Map(prev);
      if (files && files.length > 0) {
        next.set(fromUuid, files);
      } else {
        next.delete(fromUuid);
      }
      return next;
    });
  }, []);

  const {
    socket,
    sessionId,
    clientUuid,
    peers,
    photos,
    sendPhoto,
    addLocalPhoto,
    sendSessionOffer,
    setSessionId: overrideSessionId,
    sendPeerDecision,
  } = useSessionSockets({
    isMobile,
    deviceName,
    onDecryptPhoto: decryptPhoto,
    onSessionOffer: (payload) => {
      if (!payload?.enc) return;
      const doDecrypt = async () => {
        try {
          const plain = await decryptJsonWithSecret(offerSecret, payload.enc, "offer-share");
          if (!plain?.session || !plain?.seed) {
            setOfferStatus(t("status.offerIncomplete"));
            return;
          }
          setOfferStatus(t("status.offerReceived"));
          setIncomingOffer({
            session: plain.session,
            seed: plain.seed || "",
            offerSecret: plain.offerSecret || offerSecret,
            from: payload.fromDevice || payload.fromRole || "Peer",
            fromUuid: payload.fromUuid || "",
          });
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
    onPeerFileList: handlePeerFileList,
  });

  const approvePeer = useCallback(
    (uuid) => {
      sendPeerDecision(uuid, "approve");
    },
    [sendPeerDecision]
  );

  const rejectPeer = useCallback(
    (uuid) => {
      sendPeerDecision(uuid, "reject");
    },
    [sendPeerDecision]
  );

  // File Transfer State
  const [sharedFiles, setSharedFiles] = useState([]); // Own files to share
  const [peerFiles, setPeerFiles] = useState(new Map()); // peerUuid -> file list
  const [receivedBlobs, setReceivedBlobs] = useState(new Map()); // fileId -> blob

  // WebRTC & File Transfer Hooks (only on desktop)
  const webRTC = useWebRTC({
    socket,
    clientUuid,
    enabled: !isMobile,
  });

  const fileTransfer = useFileTransfer();

  // Note: WebRTC connections are now created on-demand when downloading files
  // This avoids unnecessary connection attempts and errors when no transfer is needed

  // Broadcast own file list to peers when it changes
  useEffect(() => {
    if (isMobile || !socket || !socket.connected) return;

    const fileMetadata = sharedFiles.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.type,
      ownerUuid: clientUuid,
    }));

    socket.emit("file-list-update", { files: fileMetadata });
  }, [sharedFiles, socket, clientUuid, isMobile]);

  // Socket.io fallback: Handle file requests
  useEffect(() => {
    if (isMobile || !socket) return;

    const handleFileRequestSocketio = async ({ fromUuid, fileId }) => {
      const fileToSend = sharedFiles.find((f) => f.id === fileId);
      if (!fileToSend || !fileToSend.file) return;

      // Send file metadata first
      const totalChunks = Math.ceil(fileToSend.file.size / (64 * 1024));
      socket.emit("file-transfer-socketio-start", {
        targetUuid: fromUuid,
        fileId,
        fileName: fileToSend.name,
        fileSize: fileToSend.file.size,
        fileType: fileToSend.type,
        totalChunks,
      });

      // Send file in chunks via Socket.io using binary frames (no base64)
      const CHUNK_SIZE = 64 * 1024; // 64KB chunks for Socket.io

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileToSend.file.size);
        const chunk = fileToSend.file.slice(start, end);
        const arrayBuffer = await chunk.arrayBuffer();

        // Send binary data directly (Socket.io supports binary)
        socket.emit("file-transfer-socketio", {
          targetUuid: fromUuid,
          fileId,
          chunk: arrayBuffer, // Send as ArrayBuffer directly
          chunkIndex: i,
        });
      }

      // Send completion signal
      socket.emit("file-transfer-socketio-complete", {
        targetUuid: fromUuid,
        fileId,
      });
    };

    socket.on("file-request-socketio", handleFileRequestSocketio);

    return () => {
      socket.off("file-request-socketio", handleFileRequestSocketio);
    };
  }, [socket, isMobile, sharedFiles]);

  // Socket.io fallback: Receive file chunks
  useEffect(() => {
    if (isMobile || !socket) return;

    const fileChunks = new Map(); // fileId -> { chunks: Map, fileName, fileSize, fileType, totalChunks }

    const handleFileTransferStart = ({ fileId, fileName, fileSize, fileType, totalChunks }) => {
      console.log(`[Socket.io] Receiving file ${fileName} (${fileSize} bytes, ${totalChunks} chunks)`);
      fileChunks.set(fileId, {
        chunks: new Map(), // Use Map for indexed chunks
        fileName,
        fileSize,
        fileType,
        totalChunks,
      });
    };

    const handleFileTransferSocketio = ({ fileId, chunk, chunkIndex }) => {
      const transfer = fileChunks.get(fileId);
      if (!transfer) {
        console.warn(`[Socket.io] Received chunk for unknown file ${fileId}`);
        return;
      }

      // Store chunk at correct index (supports out-of-order arrival)
      transfer.chunks.set(chunkIndex, chunk);

      console.log(`[Socket.io] Received chunk ${chunkIndex + 1}/${transfer.totalChunks} for ${transfer.fileName}`);
    };

    const handleFileTransferComplete = ({ fileId }) => {
      const transfer = fileChunks.get(fileId);
      if (!transfer) {
        console.warn(`[Socket.io] Received completion for unknown file ${fileId}`);
        return;
      }

      // Check if all chunks received
      if (transfer.chunks.size !== transfer.totalChunks) {
        console.error(`[Socket.io] Missing chunks: received ${transfer.chunks.size}/${transfer.totalChunks}`);
        fileChunks.delete(fileId);
        return;
      }

      // Assemble chunks in order
      const orderedChunks = [];
      for (let i = 0; i < transfer.totalChunks; i++) {
        const chunk = transfer.chunks.get(i);
        if (!chunk) {
          console.error(`[Socket.io] Missing chunk ${i} for ${transfer.fileName}`);
          fileChunks.delete(fileId);
          return;
        }
        orderedChunks.push(chunk);
      }

      const blob = new Blob(orderedChunks, { type: transfer.fileType });

      // Auto-download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = transfer.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log(`[Socket.io] File ${transfer.fileName} downloaded successfully`);
      fileChunks.delete(fileId);
    };

    socket.on("file-transfer-socketio-start", handleFileTransferStart);
    socket.on("file-transfer-socketio", handleFileTransferSocketio);
    socket.on("file-transfer-socketio-complete", handleFileTransferComplete);

    return () => {
      socket.off("file-transfer-socketio-start", handleFileTransferStart);
      socket.off("file-transfer-socketio", handleFileTransferSocketio);
      socket.off("file-transfer-socketio-complete", handleFileTransferComplete);
    };
  }, [socket, isMobile]);

  // Track which peers have handlers set up to avoid duplicate registrations
  const registeredHandlersRef = useRef(new Map()); // peerUuid -> cleanup function
  const sharedFilesRef = useRef(sharedFiles);
  sharedFilesRef.current = sharedFiles; // Keep ref updated for use in callbacks

  // Setup file receiver and sender on data channels
  // Uses registerMessageCallback to handle ALL messages (including buffered ones)
  // IMPORTANT: We use ONE unified handler per peer to ensure shared state (activeTransfers)
  useEffect(() => {
    if (isMobile) return;

    // Get current set of peer UUIDs
    const currentPeers = new Set(webRTC.dataChannels.keys());
    const registeredPeers = new Set(registeredHandlersRef.current.keys());

    // Remove handlers for peers that are no longer connected
    for (const peerUuid of registeredPeers) {
      if (!currentPeers.has(peerUuid)) {
        console.log(`[App] Removing handler for disconnected peer ${peerUuid}`);
        const cleanup = registeredHandlersRef.current.get(peerUuid);
        if (cleanup) cleanup();
        registeredHandlersRef.current.delete(peerUuid);
      }
    }

    // Add handlers for new peers only
    webRTC.dataChannels.forEach((dataChannel, peerUuid) => {
      // Skip if already registered
      if (registeredHandlersRef.current.has(peerUuid)) {
        return;
      }

      console.log(`[App] Setting up handler for new peer ${peerUuid}`);

      // Create a unified message handler using createMessageHandler
      // This ensures file-start, file-chunk, and file-complete share the same activeTransfers Map
      const fileTransferHandler = fileTransfer.createMessageHandler(
        // onFileReceived callback
        ({ fileName, blob, transferId }) => {
          // Save received blob
          setReceivedBlobs((prev) => {
            const next = new Map(prev);
            next.set(transferId, { fileName, blob });
            return next;
          });

          // Auto-download
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        },
        // onFileRequest callback - use ref to always get latest sharedFiles
        (fileId) => {
          const fileToSend = sharedFilesRef.current.find((f) => f.id === fileId);
          if (fileToSend && fileToSend.file) {
            console.log(`[App] Sending file ${fileToSend.name} via WebRTC to ${peerUuid}`);
            fileTransfer.sendFile(fileToSend.file, dataChannel, peerUuid);
          } else {
            console.error(`[App] Requested file not found or File object missing: ${fileId}`);
          }
        }
      );

      // Register the unified handler with WebRTC's callback system
      // This ensures buffered messages are delivered to the SAME handler
      // that will process file-start/chunk/complete with shared state
      const callbackCleanup = webRTC.registerMessageCallback(peerUuid, fileTransferHandler);

      registeredHandlersRef.current.set(peerUuid, callbackCleanup);
    });

    // Cleanup on unmount only - don't clean up on every re-render
    return () => {
      // Only cleanup everything on unmount (when isMobile changes or component unmounts)
    };
  }, [webRTC.dataChannels, webRTC.registerMessageCallback, fileTransfer, isMobile]);

  // Cleanup all handlers on unmount
  useEffect(() => {
    return () => {
      registeredHandlersRef.current.forEach((cleanup) => cleanup());
      registeredHandlersRef.current.clear();
    };
  }, []);

  // Handle file download (initiate transfer)
  const handleFileDownload = useCallback(
    async (file) => {
      if (isMobile || !file.ownerUuid) return;

      const peerUuid = file.ownerUuid;

      // Validate peer is still in session (peers use clientUuid property)
      const peerExists = peers.some(p => p.clientUuid === peerUuid);
      if (!peerExists) {
        console.error(`[App] Peer ${peerUuid} is no longer in session`);
        alert("The peer who owns this file is no longer connected.");
        return;
      }

      let dataChannel = webRTC.dataChannels.get(peerUuid);

      // Check if Socket.io fallback is allowed
      const forceWebRTC = import.meta.env.VITE_FORCE_WEBRTC === "true";

      // If no data channel exists, create WebRTC connection
      if (!dataChannel || dataChannel.readyState !== "open") {
        console.log(`[App] Initiating WebRTC connection to ${peerUuid} for file download`);

        // createOffer now returns a Promise that resolves when DataChannel is open
        dataChannel = await webRTC.createOffer(peerUuid, 15000);

        if (dataChannel) {
          console.log(`[App] WebRTC DataChannel ready for ${peerUuid}`);
        }
      }

      if (!dataChannel || dataChannel.readyState !== "open") {
        if (forceWebRTC) {
          // WebRTC-only mode: do not fallback to Socket.io
          console.error(`[App] WebRTC not available for ${peerUuid} and Socket.io fallback is disabled (VITE_FORCE_WEBRTC=true)`);
          alert("WebRTC connection failed. Socket.io fallback is disabled in development mode.");
          return;
        }

        // Fallback: Request file via Socket.io
        console.log(`[App] WebRTC not available for ${peerUuid}, using Socket.io fallback`);
        socket.emit("file-request-socketio", {
          targetUuid: peerUuid,
          fileId: file.id,
        });
        return;
      }

      // Send file download request via DataChannel
      console.log(`[App] Requesting file via WebRTC DataChannel from ${peerUuid}`);
      const request = {
        type: "file-request",
        fileId: file.id,
      };
      dataChannel.send(JSON.stringify(request));
    },
    [isMobile, webRTC, peers, socket]
  );

  // Handle own file list changes
  const handleSharedFilesChange = useCallback((files) => {
    setSharedFiles(files);
  }, []);

  // Handle removing a file from own shared files
  const handleRemoveFile = useCallback((fileId) => {
    setSharedFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

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
      if (!offer?.session) {
        setQrStatus(t("status.noSession"));
        return;
      }

      // Validate QR code TTL (10 minutes = 600000ms)
      const QR_TTL_MS = 10 * 60 * 1000;
      if (offer.timestamp) {
        const age = Date.now() - Number(offer.timestamp);
        if (age > QR_TTL_MS) {
          setQrStatus(t("status.qrExpired"));
          setTimeout(() => setQrStatus(""), 3000);
          return;
        }
      }

      const params = new URLSearchParams(window.location.search);
      params.set("session", offer.session);
      if (offer.targetUuid) params.set("uid", offer.targetUuid);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, "", newUrl);
      overrideSessionId?.(offer.session);
      if (offer.offerSecret) setOfferSecret(offer.offerSecret);
      if (offer.seed) {
        applySeedAndStore(offer.seed, offer.session);
      }
      setQrStatus(t("status.sessionTaken"));
      setTimeout(() => setQrStatus(""), 2000);
    },
    [applySeedAndStore, overrideSessionId, t]
  );

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

  useQrScanner({
    enabled: qrMode,
    videoRef,
    onStart: () => {
      setQrStatus(t("mobile.qr.scanActive"));
      setQrOffer(null);
    },
    onStop: () => setQrStatus(""),
    onResult: (parsed) => {
      if (!parsed?.session) return;
      setQrStatus(t("mobile.qr.recognized", { session: parsed.session }));
      setQrOffer(parsed);
      setQrMode(false);
      setTimeout(() => setQrStatus(""), 4000);
    },
  });

  const pendingPeers = useMemo(
    () =>
      Object.entries(peerStatuses)
        .filter(([uuid, status]) => status === "pending" && uuid !== clientUuid)
        .map(([uuid]) => uuid),
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

      const seed = isMobile ? seedFromHash : sessionSeed || seedFromHash || generateSeedBase64Url(16);
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
      sharedFiles={sharedFiles}
      onSharedFilesChange={handleSharedFilesChange}
      allFiles={allFiles}
      onFileDownload={handleFileDownload}
      onRemoveFile={handleRemoveFile}
      fileTransfers={fileTransfer.transfers}
      webRTCConnections={webRTC.connectionStates}
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
      pendingPeers={pendingPeers}
      approvePeer={approvePeer}
      rejectPeer={rejectPeer}
      clientUuid={clientUuid}
      qrUrl={qrUrl}
    />
  );
}
