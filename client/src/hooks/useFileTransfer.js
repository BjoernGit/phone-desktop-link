import { useState, useCallback, useRef } from "react";

const CHUNK_SIZE = 16384; // 16 KB (recommended for WebRTC)
const MAX_BUFFERED_AMOUNT = 256 * 1024; // 256 KB - threshold before pausing
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB max file size
const TRANSFER_CLEANUP_DELAY = 30 * 1000; // 30 seconds after completion
const BACKPRESSURE_BASE_DELAY = 5; // Base delay in ms for backpressure
const BACKPRESSURE_MAX_DELAY = 100; // Max delay in ms for backpressure

/**
 * File Transfer Hook for sending/receiving files via WebRTC DataChannel
 */
export function useFileTransfer() {
  const [transfers, setTransfers] = useState(new Map()); // transferId -> transfer state
  const transfersRef = useRef(new Map());
  const receiveBuffersRef = useRef(new Map()); // transferId -> chunks map (index -> data)
  const transferTimeoutsRef = useRef(new Map()); // transferId -> timeout handle
  const cleanupTimeoutsRef = useRef(new Map()); // transferId -> cleanup timeout handle

  // Generate unique transfer ID with better collision resistance
  const generateTransferId = () => {
    // Use crypto.randomUUID if available, fallback to timestamp + random
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // More entropy: timestamp (ms) + performance.now() + random
    const timestamp = Date.now();
    const perfNow = performance.now().toString().replace('.', '');
    const random = Math.random().toString(36).substring(2, 15);
    return `${timestamp}-${perfNow}-${random}`;
  };

  // Send file through data channel
  const sendFile = useCallback(async (file, dataChannel, peerUuid, onProgress) => {
    if (!dataChannel || dataChannel.readyState !== "open") {
      throw new Error("Data channel is not open");
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)} MB`);
    }

    const transferId = generateTransferId();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // Send file metadata first
    const metadata = {
      type: "file-start",
      transferId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      totalChunks,
    };
    dataChannel.send(JSON.stringify(metadata));

    // Initialize transfer state
    const transferState = {
      transferId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      sentChunks: 0,
      progress: 0,
      status: "sending",
    };
    transfersRef.current.set(transferId, transferState);
    setTransfers(new Map(transfersRef.current));

    // Send file in chunks with backpressure control
    let offset = 0;
    let chunkIndex = 0;
    let cancelled = false;
    let backpressureDelay = BACKPRESSURE_BASE_DELAY; // Adaptive backpressure delay

    // Set transfer timeout (5 minutes)
    const timeoutHandle = setTimeout(() => {
      cancelled = true;
      transferState.status = "timeout";
      transfersRef.current.set(transferId, transferState);
      setTransfers(new Map(transfersRef.current));
      console.error(`[FileTransfer] Transfer ${transferId} timed out`);
    }, 5 * 60 * 1000);

    transferTimeoutsRef.current.set(transferId, timeoutHandle);

    // Schedule cleanup after completion
    const scheduleCleanup = () => {
      const cleanupHandle = setTimeout(() => {
        transfersRef.current.delete(transferId);
        setTransfers(new Map(transfersRef.current));
        cleanupTimeoutsRef.current.delete(transferId);
      }, TRANSFER_CLEANUP_DELAY);
      cleanupTimeoutsRef.current.set(transferId, cleanupHandle);
    };

    const sendNextChunk = async () => {
      // Check if transfer was cancelled or channel closed
      if (cancelled) {
        clearTimeout(timeoutHandle);
        transferTimeoutsRef.current.delete(transferId);
        return;
      }

      if (dataChannel.readyState !== "open") {
        transferState.status = "failed";
        transferState.error = "DataChannel closed during transfer";
        transfersRef.current.set(transferId, transferState);
        setTransfers(new Map(transfersRef.current));
        clearTimeout(timeoutHandle);
        transferTimeoutsRef.current.delete(transferId);
        return;
      }

      // Adaptive backpressure - exponential backoff when buffer is full
      if (dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        // Increase delay exponentially, cap at max
        backpressureDelay = Math.min(backpressureDelay * 1.5, BACKPRESSURE_MAX_DELAY);
        setTimeout(sendNextChunk, backpressureDelay);
        return;
      } else {
        // Reset delay when buffer is manageable
        backpressureDelay = BACKPRESSURE_BASE_DELAY;
      }

      if (offset >= file.size) {
        // Transfer complete
        const completeMsg = {
          type: "file-complete",
          transferId,
        };
        dataChannel.send(JSON.stringify(completeMsg));

        transferState.status = "completed";
        transferState.progress = 100;
        transfersRef.current.set(transferId, transferState);
        setTransfers(new Map(transfersRef.current));

        if (onProgress) onProgress(transferState);

        clearTimeout(timeoutHandle);
        transferTimeoutsRef.current.delete(transferId);

        // Schedule automatic cleanup
        scheduleCleanup();
        return;
      }

      const chunk = file.slice(offset, offset + CHUNK_SIZE);
      const arrayBuffer = await chunk.arrayBuffer();

      // Send chunk header with index for ordering
      const header = {
        type: "file-chunk",
        transferId,
        chunkIndex,
      };
      dataChannel.send(JSON.stringify(header));

      // Send chunk data
      dataChannel.send(arrayBuffer);

      offset += CHUNK_SIZE;
      chunkIndex++;

      // Update progress
      transferState.sentChunks = chunkIndex;
      transferState.progress = Math.round((offset / file.size) * 100);
      transfersRef.current.set(transferId, transferState);
      setTransfers(new Map(transfersRef.current));

      if (onProgress) onProgress(transferState);

      // Schedule next chunk immediately (backpressure will control rate)
      setTimeout(sendNextChunk, 0);
    };

    await sendNextChunk();
    return transferId;
  }, []);

  // Create a message handler for file transfers
  // Returns a handler function that can be used with registerMessageCallback or addEventListener
  // onFileRequest callback is called when a file-request message is received (for sender-side handling)
  const createMessageHandler = useCallback((onFileReceived, onFileRequest) => {
    // transferId -> { transfer, chunks, pendingChunkHeaders (queue of expected chunk indices) }
    const activeTransfers = new Map();

    // Schedule cleanup after successful transfer
    const scheduleCleanup = (transferId) => {
      const cleanupHandle = setTimeout(() => {
        transfersRef.current.delete(transferId);
        setTransfers(new Map(transfersRef.current));
        cleanupTimeoutsRef.current.delete(transferId);
      }, TRANSFER_CLEANUP_DELAY);
      cleanupTimeoutsRef.current.set(transferId, cleanupHandle);
    };

    // Message handler that processes file transfer messages
    const messageHandler = async (event) => {
      if (typeof event.data === "string") {
        // Control message
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          console.error(`[FileTransfer] Failed to parse message:`, e);
          return;
        }

        // Handle file-request (sender side) - delegate to callback
        if (msg.type === "file-request" && onFileRequest) {
          console.log(`[FileTransfer] Received file-request for ${msg.fileId}`);
          onFileRequest(msg.fileId);
          return;
        }

        if (msg.type === "file-start") {
          // Validate file size
          if (msg.fileSize > MAX_FILE_SIZE) {
            console.error(`[FileTransfer] Rejected file ${msg.fileName} - size ${msg.fileSize} exceeds maximum ${MAX_FILE_SIZE}`);
            return;
          }

          // New file transfer starting
          const currentTransfer = {
            transferId: msg.transferId,
            fileName: msg.fileName,
            fileSize: msg.fileSize,
            fileType: msg.fileType,
            totalChunks: msg.totalChunks,
            receivedChunks: 0,
            progress: 0,
            status: "receiving",
          };

          // Use Map for chunks to support out-of-order arrival
          const chunksMap = new Map(); // chunkIndex -> ArrayBuffer

          // Use a queue for pending chunk headers to prevent race conditions
          // Each chunk header adds to queue, each ArrayBuffer consumes from queue
          const pendingChunkHeaders = [];

          activeTransfers.set(msg.transferId, {
            transfer: currentTransfer,
            chunks: chunksMap,
            pendingChunkHeaders, // Queue-based system instead of single nextChunkIndex
          });

          receiveBuffersRef.current.set(msg.transferId, chunksMap);

          transfersRef.current.set(msg.transferId, currentTransfer);
          setTransfers(new Map(transfersRef.current));

          // Set timeout for incomplete transfers (5 minutes)
          const timeoutHandle = setTimeout(() => {
            if (activeTransfers.has(msg.transferId)) {
              const { transfer } = activeTransfers.get(msg.transferId);
              transfer.status = "timeout";
              transfersRef.current.set(msg.transferId, transfer);
              setTransfers(new Map(transfersRef.current));
              activeTransfers.delete(msg.transferId);
              receiveBuffersRef.current.delete(msg.transferId);
              transferTimeoutsRef.current.delete(msg.transferId);
              console.error(`[FileTransfer] Receive timeout for ${msg.transferId}`);
            }
          }, 5 * 60 * 1000);

          transferTimeoutsRef.current.set(msg.transferId, timeoutHandle);

        } else if (msg.type === "file-chunk") {
          // Chunk header received - add to queue for this transfer
          const transferData = activeTransfers.get(msg.transferId);
          if (transferData) {
            // Push to queue - will be consumed by next ArrayBuffer for this transfer
            transferData.pendingChunkHeaders.push({
              chunkIndex: msg.chunkIndex,
              timestamp: Date.now(),
            });
          } else {
            console.warn(`[FileTransfer] Received chunk header for unknown transfer ${msg.transferId}`);
          }
        } else if (msg.type === "file-complete") {
          // File transfer complete, assemble the file
          const transferData = activeTransfers.get(msg.transferId);

          if (transferData) {
            const { transfer, chunks, pendingChunkHeaders } = transferData;

            // Check for unprocessed chunk headers (indicates lost data)
            if (pendingChunkHeaders.length > 0) {
              console.warn(`[FileTransfer] ${pendingChunkHeaders.length} chunk headers without data for ${msg.transferId}`);
            }

            // Find missing chunks for detailed error reporting
            const missingChunks = [];
            for (let i = 0; i < transfer.totalChunks; i++) {
              if (!chunks.has(i)) {
                missingChunks.push(i);
              }
            }

            if (missingChunks.length > 0) {
              console.error(`[FileTransfer] Missing ${missingChunks.length} chunks for ${msg.transferId}: [${missingChunks.slice(0, 10).join(', ')}${missingChunks.length > 10 ? '...' : ''}]`);
              transfer.status = "failed";
              transfer.error = `Missing ${missingChunks.length} chunk(s): ${missingChunks.slice(0, 5).join(', ')}${missingChunks.length > 5 ? '...' : ''}`;
              transfersRef.current.set(msg.transferId, transfer);
              setTransfers(new Map(transfersRef.current));
              activeTransfers.delete(msg.transferId);
              receiveBuffersRef.current.delete(msg.transferId);

              // Clear timeout
              const timeoutHandle = transferTimeoutsRef.current.get(msg.transferId);
              if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                transferTimeoutsRef.current.delete(msg.transferId);
              }
              return;
            }

            // All chunks present, assemble file
            const sortedChunks = [];
            for (let i = 0; i < transfer.totalChunks; i++) {
              sortedChunks.push(chunks.get(i));
            }

            const blob = new Blob(sortedChunks, { type: transfer.fileType });

            transfer.status = "completed";
            transfer.progress = 100;
            transfersRef.current.set(msg.transferId, transfer);
            setTransfers(new Map(transfersRef.current));

            if (onFileReceived) {
              onFileReceived({
                fileName: transfer.fileName,
                blob,
                transferId: transfer.transferId,
              });
            }

            activeTransfers.delete(msg.transferId);
            receiveBuffersRef.current.delete(msg.transferId);

            // Clear timeout
            const timeoutHandle = transferTimeoutsRef.current.get(msg.transferId);
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
              transferTimeoutsRef.current.delete(msg.transferId);
            }

            // Schedule automatic cleanup
            scheduleCleanup(msg.transferId);
          }
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Chunk data received - find the transfer with pending headers
        // DataChannel is ordered, so we match ArrayBuffers to headers in FIFO order
        for (const [transferId, transferData] of activeTransfers.entries()) {
          const { transfer, chunks, pendingChunkHeaders } = transferData;

          // Check if this transfer has a pending chunk header
          if (pendingChunkHeaders.length > 0) {
            // Consume the oldest header from the queue (FIFO)
            const headerInfo = pendingChunkHeaders.shift();
            const chunkIndex = headerInfo.chunkIndex;

            // Store chunk at the correct index
            chunks.set(chunkIndex, event.data);

            // Update progress based on unique chunks received
            transfer.receivedChunks = chunks.size;
            transfer.progress = Math.round(
              (chunks.size / transfer.totalChunks) * 100
            );

            transfersRef.current.set(transferId, transfer);
            setTransfers(new Map(transfersRef.current));
            break;
          }
        }
      }
    };

    // Return the message handler - caller is responsible for attaching it
    return messageHandler;
  }, []);

  // Setup data channel for receiving files (legacy method - attaches listener directly)
  // For new code, prefer createMessageHandler with registerMessageCallback
  const setupReceiver = useCallback((dataChannel, onFileReceived, onFileRequest) => {
    const messageHandler = createMessageHandler(onFileReceived, onFileRequest);

    // Use addEventListener to allow multiple handlers
    dataChannel.addEventListener("message", messageHandler);

    // Return cleanup function to remove the listener
    return () => {
      dataChannel.removeEventListener("message", messageHandler);
    };
  }, [createMessageHandler]);

  // Clear transfer from state
  const clearTransfer = useCallback((transferId) => {
    transfersRef.current.delete(transferId);
    setTransfers(new Map(transfersRef.current));
    receiveBuffersRef.current.delete(transferId);

    // Clear transfer timeout if exists
    const timeoutHandle = transferTimeoutsRef.current.get(transferId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      transferTimeoutsRef.current.delete(transferId);
    }

    // Clear cleanup timeout if exists
    const cleanupHandle = cleanupTimeoutsRef.current.get(transferId);
    if (cleanupHandle) {
      clearTimeout(cleanupHandle);
      cleanupTimeoutsRef.current.delete(transferId);
    }
  }, []);

  // Clear all completed/failed transfers (manual cleanup)
  const clearCompletedTransfers = useCallback(() => {
    const toDelete = [];
    for (const [transferId, transfer] of transfersRef.current.entries()) {
      if (transfer.status === "completed" || transfer.status === "failed" || transfer.status === "timeout") {
        toDelete.push(transferId);
      }
    }
    for (const transferId of toDelete) {
      clearTransfer(transferId);
    }
  }, [clearTransfer]);

  return {
    transfers,
    sendFile,
    setupReceiver,
    createMessageHandler,
    clearTransfer,
    clearCompletedTransfers,
  };
}
