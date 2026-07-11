import { useCallback, useEffect, useRef, useState } from "react";
import { useWebRTC, DEBUG_WEBRTC } from "./useWebRTC";
import { useFileTransfer } from "./useFileTransfer";
import { FILE_TRANSFER_CONFIG } from "../config/fileTransfer";
import { requestDirectConnectionBoost } from "../utils/directConnection";

// Constants
const SOCKETIO_CHUNK_SIZE = 64 * 1024; // 64KB chunks for Socket.io
const SOCKETIO_MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
const DEBUG_FILE_TRANSFER = false; // Set to true for verbose file transfer logging

// Retry configuration
const MAX_RETRY_ATTEMPTS = FILE_TRANSFER_CONFIG.MAX_RETRY_ATTEMPTS || 3;
const RETRY_DELAY_MS = FILE_TRANSFER_CONFIG.RETRY_DELAY_MS || 2000;

/**
 * Hook that orchestrates all file transfer functionality:
 * - WebRTC P2P file transfers
 * - Socket.io fallback transfers
 * - Eager WebRTC connection establishment
 * - File list broadcasting
 *
 * @param {Object} options
 * @param {Object} options.socket - Socket.io socket instance
 * @param {string} options.clientUuid - Current client's UUID
 * @param {Array} options.peers - Array of connected peers
 * @param {boolean} options.directConnectionPromptEnabled - Offer the camera-permission
 *   "direct connection boost" when WebRTC fails (desktop only; the modal lives there)
 */
export function useAppFileTransfer({ socket, clientUuid, peers, directConnectionPromptEnabled = false }) {
  // File state
  const [sharedFiles, setSharedFiles] = useState([]); // Own files to share
  const [peerFiles, setPeerFiles] = useState(new Map()); // peerUuid -> file list
  const [receivedBlobs, setReceivedBlobs] = useState(new Map()); // fileId -> blob

  // Alert state for error messages
  const [alertMessage, setAlertMessage] = useState(null); // { title, message }

  const showAlert = useCallback((title, message) => {
    setAlertMessage({ title, message });
  }, []);

  const clearAlert = useCallback(() => {
    setAlertMessage(null);
  }, []);

  // Direct connection boost: offered once per session when WebRTC fails.
  // Granting camera/mic permission unmasks the local IP in ICE candidates,
  // which fixes P2P on multicast-blocking LANs (see utils/directConnection.js).
  const [directConnectionPrompt, setDirectConnectionPrompt] = useState(null); // { file } | null
  const directConnectionOfferedRef = useRef(false);

  // WebRTC & File Transfer Hooks (all devices, mobile included)
  const webRTC = useWebRTC({
    socket,
    clientUuid,
  });

  const fileTransfer = useFileTransfer();

  // Refs
  const webRTCInitiatedRef = useRef(new Set());
  const webRTCWaitingRef = useRef(new Set()); // Track peers we're waiting for (to avoid log spam)
  const registeredHandlersRef = useRef(new Map());
  const sharedFilesRef = useRef(sharedFiles);
  sharedFilesRef.current = sharedFiles;

  // Track active Socket.io transfers for cancellation support
  // Map<fileId, Set<{targetUuid, cancelled: {current: boolean}}>>
  const activeSocketioTransfersRef = useRef(new Map());

  // Track retry attempts for failed downloads
  // Map<fileId, { attempts: number, lastAttempt: number }>
  const retryAttemptsRef = useRef(new Map());

  // Callback for peer file list updates (called from useSessionSockets)
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

  // Eager WebRTC: Initiate connection to new peers immediately on join
  // Use UUID comparison as tie-breaker to avoid "glare" (both sides sending offers)
  // Only the peer with the "higher" UUID initiates the connection
  useEffect(() => {
    if (!socket || !socket.connected || !clientUuid) return;

    for (const peer of peers) {
      const peerUuid = peer.clientUuid;

      if (webRTCInitiatedRef.current.has(peerUuid)) continue;
      if (webRTC.dataChannels.get(peerUuid)?.readyState === "open") continue;

      // Tie-breaker: only initiate if our UUID is "greater" than peer's
      // This ensures exactly one side initiates, avoiding glare conflicts
      if (clientUuid <= peerUuid) {
        if (!webRTCWaitingRef.current.has(peerUuid)) {
          webRTCWaitingRef.current.add(peerUuid);
          if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Eager WebRTC: Waiting for peer ${peerUuid} to initiate (tie-breaker)`);
        }
        continue;
      }

      webRTCInitiatedRef.current.add(peerUuid);
      if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Eager WebRTC: Initiating connection to peer ${peerUuid} (we are initiator)`);

      webRTC.createOffer(peerUuid, 30000).then((dc) => {
        // Double-check peer still exists before completing connection
        const peerStillExists = peers.some(p => p.clientUuid === peerUuid);
        if (!peerStillExists) {
          if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Eager WebRTC: Peer ${peerUuid} left during connection setup, aborting`);
          webRTCInitiatedRef.current.delete(peerUuid);
          return;
        }

        if (dc) {
          if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Eager WebRTC: Connection established to ${peerUuid}`);
        } else {
          console.warn(`[FileTransfer] Eager WebRTC: Connection failed to ${peerUuid}`);
          webRTCInitiatedRef.current.delete(peerUuid);
        }
      }).catch((err) => {
        console.error(`[FileTransfer] Eager WebRTC: Error connecting to ${peerUuid}:`, err);
        webRTCInitiatedRef.current.delete(peerUuid);
      });
    }

    // Clean up refs for peers that left
    for (const peerUuid of webRTCInitiatedRef.current) {
      if (!peers.some(p => p.clientUuid === peerUuid)) {
        webRTCInitiatedRef.current.delete(peerUuid);
      }
    }
    for (const peerUuid of webRTCWaitingRef.current) {
      if (!peers.some(p => p.clientUuid === peerUuid)) {
        webRTCWaitingRef.current.delete(peerUuid);
      }
    }

    // Clean up files from peers that left
    setPeerFiles((prev) => {
      const next = new Map(prev);
      let hasChanges = false;
      for (const peerUuid of next.keys()) {
        if (!peers.some(p => p.clientUuid === peerUuid)) {
          if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Removing files from disconnected peer ${peerUuid}`);
          next.delete(peerUuid);
          hasChanges = true;
        }
      }
      return hasChanges ? next : prev;
    });
  }, [peers, socket, webRTC.createOffer, webRTC.dataChannels, clientUuid]);

  // Broadcast own file list to peers when it changes
  useEffect(() => {
    if (!socket || !socket.connected) return;

    const fileMetadata = sharedFiles.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.type,
      ownerUuid: clientUuid,
    }));

    socket.emit("file-list-update", { files: fileMetadata });
  }, [sharedFiles, socket, clientUuid]);

  // Socket.io fallback: Handle file requests (sending)
  useEffect(() => {
    if (!socket) return;

    const handleFileRequestSocketio = async ({ fromUuid, fileId }) => {
      const fileToSend = sharedFiles.find((f) => f.id === fileId);
      if (!fileToSend || !fileToSend.file) {
        // File was deleted - send error message back to requester
        console.error(`[Socket.io] Requested file not found: ${fileId}`);
        socket.emit("file-transfer-socketio-error", {
          targetUuid: fromUuid,
          fileId,
          fileName: fileToSend?.name || fileId,
          error: "file-not-found",
        });
        return;
      }

      // Track this transfer for cancellation support
      const cancelledRef = { current: false };
      const transferInfo = { targetUuid: fromUuid, cancelledRef, fileName: fileToSend.name };

      if (!activeSocketioTransfersRef.current.has(fileId)) {
        activeSocketioTransfersRef.current.set(fileId, new Set());
      }
      activeSocketioTransfersRef.current.get(fileId).add(transferInfo);

      const totalChunks = Math.ceil(fileToSend.file.size / SOCKETIO_CHUNK_SIZE);
      socket.emit("file-transfer-socketio-start", {
        targetUuid: fromUuid,
        fileId,
        fileName: fileToSend.name,
        fileSize: fileToSend.file.size,
        fileType: fileToSend.type,
        totalChunks,
      });

      for (let i = 0; i < totalChunks; i++) {
        // Check if transfer was cancelled (file removed by sender)
        if (cancelledRef.current) {
          console.log(`[Socket.io] Transfer cancelled for ${fileToSend.name} at chunk ${i}/${totalChunks}`);
          socket.emit("file-transfer-socketio-revoked", {
            targetUuid: fromUuid,
            fileId,
            fileName: fileToSend.name,
          });
          // Cleanup tracking
          const transfers = activeSocketioTransfersRef.current.get(fileId);
          if (transfers) {
            transfers.delete(transferInfo);
            if (transfers.size === 0) {
              activeSocketioTransfersRef.current.delete(fileId);
            }
          }
          return;
        }

        const start = i * SOCKETIO_CHUNK_SIZE;
        const end = Math.min(start + SOCKETIO_CHUNK_SIZE, fileToSend.file.size);
        const chunk = fileToSend.file.slice(start, end);
        const arrayBuffer = await chunk.arrayBuffer();

        socket.emit("file-transfer-socketio", {
          targetUuid: fromUuid,
          fileId,
          chunk: arrayBuffer,
          chunkIndex: i,
        });
      }

      // Cleanup tracking on successful completion
      const transfers = activeSocketioTransfersRef.current.get(fileId);
      if (transfers) {
        transfers.delete(transferInfo);
        if (transfers.size === 0) {
          activeSocketioTransfersRef.current.delete(fileId);
        }
      }

      socket.emit("file-transfer-socketio-complete", {
        targetUuid: fromUuid,
        fileId,
      });
    };

    socket.on("file-request-socketio", handleFileRequestSocketio);
    return () => {
      socket.off("file-request-socketio", handleFileRequestSocketio);
    };
  }, [socket, sharedFiles]);

  // Socket.io fallback: Receive file chunks
  useEffect(() => {
    if (!socket) return;

    const fileChunks = new Map();

    const handleFileTransferStart = ({ fileId, fileName, fileSize, fileType, totalChunks }) => {
      console.log(`[Socket.io] Receiving file ${fileName} (${fileSize} bytes, ${totalChunks} chunks)`);
      fileChunks.set(fileId, {
        chunks: new Map(),
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
      transfer.chunks.set(chunkIndex, chunk);
      console.log(`[Socket.io] Received chunk ${chunkIndex + 1}/${transfer.totalChunks} for ${transfer.fileName}`);
    };

    const handleFileTransferComplete = ({ fileId }) => {
      const transfer = fileChunks.get(fileId);
      if (!transfer) {
        console.warn(`[Socket.io] Received completion for unknown file ${fileId}`);
        return;
      }

      if (transfer.chunks.size !== transfer.totalChunks) {
        console.error(`[Socket.io] Missing chunks: received ${transfer.chunks.size}/${transfer.totalChunks}`);
        fileChunks.delete(fileId);
        return;
      }

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

    const handleFileTransferError = ({ fileId, error, fileName }) => {
      console.error(`[Socket.io] File transfer error for ${fileId}: ${error}`);
      fileChunks.delete(fileId);
      if (error === "file-not-found") {
        showAlert(
          "desktop.fileTransfer.fileNotFound",
          `desktop.fileTransfer.fileNoLongerAvailable:${fileName || fileId}`
        );
      } else {
        showAlert("errors.fileTooLargeTitle", error);
      }
    };

    // Handle file revoked by sender mid-transfer
    const handleFileTransferRevoked = ({ fileId, fileName }) => {
      console.warn(`[Socket.io] File revoked by sender: ${fileName || fileId}`);
      // Discard any partial chunks - sender's data should not be kept
      fileChunks.delete(fileId);
      showAlert(
        "desktop.fileTransfer.fileRevoked",
        `desktop.fileTransfer.fileRevokedBySender:${fileName || fileId}`
      );
    };

    socket.on("file-transfer-socketio-start", handleFileTransferStart);
    socket.on("file-transfer-socketio", handleFileTransferSocketio);
    socket.on("file-transfer-socketio-complete", handleFileTransferComplete);
    socket.on("file-transfer-socketio-error", handleFileTransferError);
    socket.on("file-transfer-socketio-revoked", handleFileTransferRevoked);

    return () => {
      socket.off("file-transfer-socketio-start", handleFileTransferStart);
      socket.off("file-transfer-socketio", handleFileTransferSocketio);
      socket.off("file-transfer-socketio-complete", handleFileTransferComplete);
      socket.off("file-transfer-socketio-error", handleFileTransferError);
      socket.off("file-transfer-socketio-revoked", handleFileTransferRevoked);
    };
  }, [socket, showAlert]);

  // Setup WebRTC file receiver and sender on data channels
  useEffect(() => {
    const currentPeers = new Set(webRTC.dataChannels.keys());
    const registeredPeers = new Set(registeredHandlersRef.current.keys());

    // Remove handlers for disconnected peers
    for (const peerUuid of registeredPeers) {
      if (!currentPeers.has(peerUuid)) {
        if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Removing handler for disconnected peer ${peerUuid}`);
        const cleanup = registeredHandlersRef.current.get(peerUuid);
        if (cleanup) cleanup();
        registeredHandlersRef.current.delete(peerUuid);
      }
    }

    // Add handlers for new peers
    webRTC.dataChannels.forEach((dataChannel, peerUuid) => {
      if (registeredHandlersRef.current.has(peerUuid)) return;

      if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Setting up handler for new peer ${peerUuid}`);

      const fileTransferHandler = fileTransfer.createMessageHandler(
        // onFileReceived
        ({ fileName, blob, transferId }) => {
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
        // onFileRequest
        (fileId) => {
          const fileToSend = sharedFilesRef.current.find((f) => f.id === fileId);
          if (fileToSend && fileToSend.file) {
            if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Sending file ${fileToSend.name} via WebRTC to ${peerUuid}`);
            // Pass fileId so receiver can track progress in UI
            fileTransfer.sendFile(fileToSend.file, dataChannel, peerUuid, null, fileId);
          } else {
            // File was deleted - send error message back to requester
            console.error(`[FileTransfer] Requested file not found: ${fileId}`);
            if (dataChannel && dataChannel.readyState === "open") {
              dataChannel.send(JSON.stringify({
                type: "file-not-found",
                fileId,
                fileName: fileId, // We don't have the name anymore
              }));
            }
          }
        },
        // onFileNotFound
        (fileId, fileName) => {
          console.warn(`[FileTransfer] File no longer available: ${fileName || fileId}`);
          showAlert(
            "desktop.fileTransfer.fileNotFound",
            `desktop.fileTransfer.fileNoLongerAvailable:${fileName || fileId}`
          );
        },
        // onFileRevoked - sender revoked file mid-transfer
        (fileId, fileName, transferId) => {
          console.warn(`[FileTransfer] File revoked by sender: ${fileName || fileId}`);
          showAlert(
            "desktop.fileTransfer.fileRevoked",
            `desktop.fileTransfer.fileRevokedBySender:${fileName || fileId}`
          );
        }
      );

      const callbackCleanup = webRTC.registerMessageCallback(peerUuid, fileTransferHandler);
      registeredHandlersRef.current.set(peerUuid, callbackCleanup);
    });
  }, [webRTC.dataChannels, webRTC.registerMessageCallback, fileTransfer]);

  // Cleanup all handlers on unmount
  useEffect(() => {
    return () => {
      registeredHandlersRef.current.forEach((cleanup) => cleanup());
      registeredHandlersRef.current.clear();
    };
  }, []);

  /**
   * Internal function to attempt file download
   * @param {Object} file - File metadata
   * @param {boolean} isRetry - Whether this is a retry attempt
   * @returns {Promise<boolean>} - True if request was sent successfully
   */
  const attemptFileDownload = useCallback(
    async (file, isRetry = false) => {
      if (!file.ownerUuid) return false;

      const peerUuid = file.ownerUuid;

      const peerExists = peers.some(p => p.clientUuid === peerUuid);
      if (!peerExists) {
        console.error(`[FileTransfer] Peer ${peerUuid} is no longer in session`);
        return false;
      }

      let dataChannel = webRTC.dataChannels.get(peerUuid);
      const forceWebRTC = import.meta.env.VITE_FORCE_WEBRTC === "true";

      if (!dataChannel || dataChannel.readyState !== "open") {
        if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] WebRTC channel not ready for ${peerUuid}, attempting connection...`);
        dataChannel = await webRTC.createOffer(peerUuid, 15000);
        if (dataChannel && DEBUG_FILE_TRANSFER) {
          console.log(`[FileTransfer] WebRTC DataChannel ready for ${peerUuid}`);
        }
      }

      if (!dataChannel || dataChannel.readyState !== "open") {
        if (forceWebRTC) {
          console.error(`[FileTransfer] WebRTC not available and fallback disabled`);
          return false;
        }

        // Before resorting to the fallback, offer the direct connection
        // boost once per session - the modal decision resumes the download.
        if (directConnectionPromptEnabled && !directConnectionOfferedRef.current) {
          directConnectionOfferedRef.current = true;
          if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] WebRTC failed for ${peerUuid}, offering direct connection boost`);
          setDirectConnectionPrompt({ file });
          return true;
        }

        if (file.size > SOCKETIO_MAX_FILE_SIZE) {
          console.error(`[FileTransfer] File too large for Socket.io fallback`);
          return false;
        }

        if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Using Socket.io fallback for ${(file.size / (1024 * 1024)).toFixed(1)}MB file`);
        socket.emit("file-request-socketio", {
          targetUuid: peerUuid,
          fileId: file.id,
        });
        return true;
      }

      if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] ${isRetry ? 'Retrying' : 'Requesting'} file via WebRTC from ${peerUuid}`);
      dataChannel.send(JSON.stringify({
        type: "file-request",
        fileId: file.id,
      }));
      return true;
    },
    [webRTC, peers, socket, directConnectionPromptEnabled]
  );

  /**
   * Retry a failed file download with exponential backoff
   * @param {Object} file - File metadata
   */
  const retryFileDownload = useCallback(
    async (file) => {
      const retryInfo = retryAttemptsRef.current.get(file.id) || { attempts: 0, lastAttempt: 0 };

      if (retryInfo.attempts >= MAX_RETRY_ATTEMPTS) {
        console.error(`[FileTransfer] Max retry attempts (${MAX_RETRY_ATTEMPTS}) reached for ${file.name}`);
        showAlert(
          "desktop.fileTransfer.maxRetriesReached",
          `desktop.fileTransfer.maxRetriesMessage:${file.name}`
        );
        retryAttemptsRef.current.delete(file.id);
        return;
      }

      // Calculate exponential backoff delay
      const delay = RETRY_DELAY_MS * Math.pow(2, retryInfo.attempts);
      const timeSinceLastAttempt = Date.now() - retryInfo.lastAttempt;

      if (timeSinceLastAttempt < delay) {
        const waitTime = delay - timeSinceLastAttempt;
        console.log(`[FileTransfer] Waiting ${waitTime}ms before retry for ${file.name}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      retryInfo.attempts++;
      retryInfo.lastAttempt = Date.now();
      retryAttemptsRef.current.set(file.id, retryInfo);

      console.log(`[FileTransfer] Retry attempt ${retryInfo.attempts}/${MAX_RETRY_ATTEMPTS} for ${file.name}`);

      const success = await attemptFileDownload(file, true);
      if (!success) {
        // If attempt failed immediately, schedule another retry
        if (retryInfo.attempts < MAX_RETRY_ATTEMPTS) {
          setTimeout(() => retryFileDownload(file), RETRY_DELAY_MS);
        } else {
          showAlert(
            "desktop.fileTransfer.maxRetriesReached",
            `desktop.fileTransfer.maxRetriesMessage:${file.name}`
          );
          retryAttemptsRef.current.delete(file.id);
        }
      }
    },
    [attemptFileDownload, showAlert]
  );

  // Handle file download (initiate transfer)
  const handleFileDownload = useCallback(
    async (file) => {
      if (!file.ownerUuid) return;

      const peerUuid = file.ownerUuid;

      const peerExists = peers.some(p => p.clientUuid === peerUuid);
      if (!peerExists) {
        console.error(`[FileTransfer] Peer ${peerUuid} is no longer in session`);
        alert("The peer who owns this file is no longer connected.");
        return;
      }

      // Reset retry counter for new download
      retryAttemptsRef.current.delete(file.id);

      const success = await attemptFileDownload(file, false);

      if (!success) {
        const forceWebRTC = import.meta.env.VITE_FORCE_WEBRTC === "true";
        if (forceWebRTC) {
          alert("WebRTC connection failed. Socket.io fallback is disabled in development mode.");
          return;
        }

        if (file.size > SOCKETIO_MAX_FILE_SIZE) {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
          const limitMB = (SOCKETIO_MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
          alert(`WebRTC connection failed and file is too large (${sizeMB}MB) for Socket.io fallback.\nMaximum size for fallback: ${limitMB}MB.\n\nPlease try again or check your network connection.`);
          return;
        }

        // Start retry process
        console.log(`[FileTransfer] Initial download failed for ${file.name}, starting retry process`);
        retryFileDownload(file);
      }
    },
    [peers, attemptFileDownload, retryFileDownload]
  );

  // User accepted the direct connection boost: request the permission
  // (unmasks the local IP), rebuild the peer connection so ICE gathers
  // fresh candidates, then retry the download from scratch.
  const acceptDirectConnection = useCallback(async () => {
    const prompt = directConnectionPrompt;
    setDirectConnectionPrompt(null);
    if (!prompt) return;

    const granted = await requestDirectConnectionBoost();
    if (granted && prompt.file.ownerUuid) {
      // Force a fresh connection - the old one gathered masked candidates
      webRTC.closeConnection(prompt.file.ownerUuid, false);
    } else if (!granted) {
      console.warn(`[FileTransfer] Direct connection boost not granted, continuing with fallback`);
    }
    handleFileDownload(prompt.file);
  }, [directConnectionPrompt, webRTC, handleFileDownload]);

  // User declined: resume the download via the normal fallback path
  // (the once-per-session flag prevents re-prompting).
  const declineDirectConnection = useCallback(() => {
    const prompt = directConnectionPrompt;
    setDirectConnectionPrompt(null);
    if (prompt) handleFileDownload(prompt.file);
  }, [directConnectionPrompt, handleFileDownload]);

  // Handle own file list changes
  const handleSharedFilesChange = useCallback((files) => {
    setSharedFiles(files);
  }, []);

  // Handle removing a file from own shared files
  // Cancels any active transfers for this file before removing
  const handleRemoveFile = useCallback((fileId) => {
    // First: cancel all active WebRTC transfers for this file
    // This sends FILE_REVOKED to receivers, who will discard partial data
    const cancelledWebRTC = fileTransfer.cancelTransfersForFile(fileId);
    if (cancelledWebRTC > 0) {
      console.log(`[FileTransfer] Cancelled ${cancelledWebRTC} active WebRTC transfer(s) for removed file ${fileId}`);
    }

    // Second: cancel all active Socket.io transfers for this file
    const socketioTransfers = activeSocketioTransfersRef.current.get(fileId);
    if (socketioTransfers && socketioTransfers.size > 0) {
      let cancelledSocketio = 0;
      for (const transferInfo of socketioTransfers) {
        transferInfo.cancelledRef.current = true;
        cancelledSocketio++;
      }
      console.log(`[FileTransfer] Cancelled ${cancelledSocketio} active Socket.io transfer(s) for removed file ${fileId}`);
    }

    // Then: remove from shared files list (also triggers broadcast to peers)
    setSharedFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, [fileTransfer]);

  // Sync file metadata list to all peers (re-broadcast)
  const syncFilesToPeer = useCallback(
    async (peerUuid) => {
      if (!peerUuid || !socket) {
        console.warn("[FileTransfer] Cannot sync: no peer UUID or no socket");
        return;
      }

      const peerExists = peers.some(p => p.clientUuid === peerUuid);
      if (!peerExists) {
        console.error(`[FileTransfer] Cannot sync: peer ${peerUuid} not in session`);
        return;
      }

      console.log(`[FileTransfer] Re-broadcasting file metadata list for late joiner ${peerUuid}`);

      // Re-emit file-list-update to trigger broadcast to all peers (including late joiner)
      // This only sends metadata (name, size, type), NOT the actual files
      const fileMetadata = sharedFiles.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        ownerUuid: clientUuid,
      }));

      socket.emit("file-list-update", { files: fileMetadata });
      console.log(`[FileTransfer] File metadata broadcast complete (${fileMetadata.length} files)`);
    },
    [sharedFiles, peers, socket, clientUuid]
  );

  // Watch for failed transfers and trigger retry
  // Store previous transfer states to detect transitions to "failed"
  const prevTransfersRef = useRef(new Map());

  useEffect(() => {
    const prevTransfers = prevTransfersRef.current;
    const currentTransfers = fileTransfer.transfers;

    // Check for transfers that just failed
    for (const [transferId, transfer] of currentTransfers.entries()) {
      const prevTransfer = prevTransfers.get(transferId);

      // Only trigger retry if transfer just transitioned to failed/timeout
      if (
        (transfer.status === "failed" || transfer.status === "timeout") &&
        prevTransfer &&
        prevTransfer.status !== "failed" &&
        prevTransfer.status !== "timeout"
      ) {
        // Find the file metadata to retry
        const fileId = transfer.fileId;
        if (!fileId) continue;

        // Find file in peerFiles
        let fileToRetry = null;
        for (const [, files] of peerFiles.entries()) {
          const found = files.find(f => f.id === fileId);
          if (found) {
            fileToRetry = found;
            break;
          }
        }

        if (fileToRetry) {
          console.log(`[FileTransfer] Transfer ${transferId} failed, scheduling automatic retry for ${fileToRetry.name}`);
          // Schedule retry with a small delay
          setTimeout(() => {
            retryFileDownload(fileToRetry);
          }, 500);
        }
      }
    }

    // Update previous transfers ref
    prevTransfersRef.current = new Map(currentTransfers);
  }, [fileTransfer.transfers, peerFiles, retryFileDownload]);

  return {
    // State
    sharedFiles,
    peerFiles,
    receivedBlobs,

    // Alert state for error messages
    alertMessage,
    clearAlert,

    // Direct connection boost prompt (desktop modal)
    directConnectionPrompt,
    acceptDirectConnection,
    declineDirectConnection,

    // Handlers
    handleFileDownload,
    handleSharedFilesChange,
    handleRemoveFile,
    handlePeerFileList,
    syncFilesToPeer,

    // Exposed for components that need it
    fileTransfers: fileTransfer.transfers,
    webRTCConnections: webRTC.connectionStates,
  };
}
