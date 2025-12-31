import { useCallback, useEffect, useRef, useState } from "react";
import { useWebRTC, DEBUG_WEBRTC } from "./useWebRTC";
import { useFileTransfer } from "./useFileTransfer";

// Constants
const SOCKETIO_CHUNK_SIZE = 64 * 1024; // 64KB chunks for Socket.io
const SOCKETIO_MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
const DEBUG_FILE_TRANSFER = false; // Set to true for verbose file transfer logging

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
 * @param {boolean} options.isMobile - Whether running on mobile device
 */
export function useAppFileTransfer({ socket, clientUuid, peers, isMobile }) {
  // File state
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

  // Refs
  const webRTCInitiatedRef = useRef(new Set());
  const webRTCWaitingRef = useRef(new Set()); // Track peers we're waiting for (to avoid log spam)
  const registeredHandlersRef = useRef(new Map());
  const sharedFilesRef = useRef(sharedFiles);
  sharedFilesRef.current = sharedFiles;

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
    if (isMobile || !socket || !socket.connected || !clientUuid) return;

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
  }, [peers, socket, isMobile, webRTC.createOffer, webRTC.dataChannels, clientUuid]);

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

  // Socket.io fallback: Handle file requests (sending)
  useEffect(() => {
    if (isMobile || !socket) return;

    const handleFileRequestSocketio = async ({ fromUuid, fileId }) => {
      const fileToSend = sharedFiles.find((f) => f.id === fileId);
      if (!fileToSend || !fileToSend.file) return;

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

    const handleFileTransferError = ({ fileId, error, message }) => {
      console.error(`[Socket.io] File transfer error for ${fileId}: ${error} - ${message}`);
      fileChunks.delete(fileId);
      alert(`File transfer failed: ${message}`);
    };

    socket.on("file-transfer-socketio-start", handleFileTransferStart);
    socket.on("file-transfer-socketio", handleFileTransferSocketio);
    socket.on("file-transfer-socketio-complete", handleFileTransferComplete);
    socket.on("file-transfer-socketio-error", handleFileTransferError);

    return () => {
      socket.off("file-transfer-socketio-start", handleFileTransferStart);
      socket.off("file-transfer-socketio", handleFileTransferSocketio);
      socket.off("file-transfer-socketio-complete", handleFileTransferComplete);
      socket.off("file-transfer-socketio-error", handleFileTransferError);
    };
  }, [socket, isMobile]);

  // Setup WebRTC file receiver and sender on data channels
  useEffect(() => {
    if (isMobile) return;

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
            console.error(`[FileTransfer] Requested file not found: ${fileId}`);
          }
        }
      );

      const callbackCleanup = webRTC.registerMessageCallback(peerUuid, fileTransferHandler);
      registeredHandlersRef.current.set(peerUuid, callbackCleanup);
    });
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

      const peerExists = peers.some(p => p.clientUuid === peerUuid);
      if (!peerExists) {
        console.error(`[FileTransfer] Peer ${peerUuid} is no longer in session`);
        alert("The peer who owns this file is no longer connected.");
        return;
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
          alert("WebRTC connection failed. Socket.io fallback is disabled in development mode.");
          return;
        }

        if (file.size > SOCKETIO_MAX_FILE_SIZE) {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
          const limitMB = (SOCKETIO_MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
          console.error(`[FileTransfer] File too large for Socket.io fallback: ${sizeMB}MB`);
          alert(`WebRTC connection failed and file is too large (${sizeMB}MB) for Socket.io fallback.\nMaximum size for fallback: ${limitMB}MB.\n\nPlease try again or check your network connection.`);
          return;
        }

        if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Using Socket.io fallback for ${(file.size / (1024 * 1024)).toFixed(1)}MB file`);
        socket.emit("file-request-socketio", {
          targetUuid: peerUuid,
          fileId: file.id,
        });
        return;
      }

      if (DEBUG_FILE_TRANSFER) console.log(`[FileTransfer] Requesting file via WebRTC from ${peerUuid}`);
      dataChannel.send(JSON.stringify({
        type: "file-request",
        fileId: file.id,
      }));
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

  return {
    // State
    sharedFiles,
    peerFiles,
    receivedBlobs,

    // Handlers
    handleFileDownload,
    handleSharedFilesChange,
    handleRemoveFile,
    handlePeerFileList,

    // Exposed for components that need it
    fileTransfers: fileTransfer.transfers,
    webRTCConnections: webRTC.connectionStates,
  };
}
