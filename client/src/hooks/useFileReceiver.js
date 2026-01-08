import { useCallback } from "react";
import {
  FILE_TRANSFER_CONFIG,
  TRANSFER_STATUS,
  FILE_MESSAGE_TYPES,
} from "../config/fileTransfer";

const {
  MAX_FILE_SIZE,
  TRANSFER_TIMEOUT_MS,
  TRANSFER_CLEANUP_DELAY_MS,
} = FILE_TRANSFER_CONFIG;

/**
 * Hook for receiving files via WebRTC DataChannel
 * Handles chunk reassembly, out-of-order handling, and progress tracking
 *
 * @param {Object} options
 * @param {React.MutableRefObject<Map>} options.transfersRef - Shared ref for transfer states
 * @param {Function} options.updateTransfers - Function to trigger state update
 * @param {React.MutableRefObject<Map>} options.receiveBuffersRef - Shared ref for receive buffers
 * @param {React.MutableRefObject<Map>} options.transferTimeoutsRef - Shared ref for timeout handles
 * @param {React.MutableRefObject<Map>} options.cleanupTimeoutsRef - Shared ref for cleanup handles
 */
export function useFileReceiver({
  transfersRef,
  updateTransfers,
  receiveBuffersRef,
  transferTimeoutsRef,
  cleanupTimeoutsRef,
}) {
  /**
   * Create a message handler for file transfers
   * Returns a handler function that can be used with registerMessageCallback or addEventListener
   *
   * @param {Function} onFileReceived - Callback when file is fully received
   * @param {Function} onFileRequest - Callback when a file-request message is received (for sender-side handling)
   * @param {Function} onFileNotFound - Callback when requested file is no longer available
   */
  const createMessageHandler = useCallback(
    (onFileReceived, onFileRequest, onFileNotFound) => {
      // transferId -> { transfer, chunks, pendingChunkHeaders }
      const activeTransfers = new Map();

      // Schedule cleanup after successful transfer
      const scheduleCleanup = (transferId) => {
        const cleanupHandle = setTimeout(() => {
          transfersRef.current.delete(transferId);
          updateTransfers();
          cleanupTimeoutsRef.current.delete(transferId);
        }, TRANSFER_CLEANUP_DELAY_MS);
        cleanupTimeoutsRef.current.set(transferId, cleanupHandle);
      };

      // Message handler that processes file transfer messages
      const messageHandler = async (event) => {
        if (typeof event.data === "string") {
          let msg;
          try {
            msg = JSON.parse(event.data);
          } catch (e) {
            console.error(`[FileReceiver] Failed to parse message:`, e);
            return;
          }

          // Handle file-request (sender side) - delegate to callback
          if (msg.type === FILE_MESSAGE_TYPES.FILE_REQUEST && onFileRequest) {
            console.log(`[FileReceiver] Received file-request for ${msg.fileId}`);
            onFileRequest(msg.fileId);
            return;
          }

          // Handle file-not-found (receiver side) - file was deleted before transfer
          if (msg.type === FILE_MESSAGE_TYPES.FILE_NOT_FOUND && onFileNotFound) {
            console.warn(`[FileReceiver] File not found: ${msg.fileId} - ${msg.fileName}`);
            onFileNotFound(msg.fileId, msg.fileName);
            return;
          }

          if (msg.type === FILE_MESSAGE_TYPES.FILE_START) {
            // Validate file size
            if (msg.fileSize > MAX_FILE_SIZE) {
              console.error(
                `[FileReceiver] Rejected file ${msg.fileName} - size ${msg.fileSize} exceeds maximum ${MAX_FILE_SIZE}`
              );
              return;
            }

            // New file transfer starting
            const currentTransfer = {
              transferId: msg.transferId,
              fileId: msg.fileId, // Original file ID for UI progress tracking
              fileName: msg.fileName,
              fileSize: msg.fileSize,
              fileType: msg.fileType,
              totalChunks: msg.totalChunks,
              receivedChunks: 0,
              progress: 0,
              status: TRANSFER_STATUS.RECEIVING,
            };

            // Use Map for chunks to support out-of-order arrival
            const chunksMap = new Map();

            // Queue for pending chunk headers to prevent race conditions
            const pendingChunkHeaders = [];

            activeTransfers.set(msg.transferId, {
              transfer: currentTransfer,
              chunks: chunksMap,
              pendingChunkHeaders,
            });

            receiveBuffersRef.current.set(msg.transferId, chunksMap);

            transfersRef.current.set(msg.transferId, currentTransfer);
            updateTransfers();

            // Set timeout for incomplete transfers
            const timeoutHandle = setTimeout(() => {
              if (activeTransfers.has(msg.transferId)) {
                const { transfer } = activeTransfers.get(msg.transferId);
                transfer.status = TRANSFER_STATUS.TIMEOUT;
                transfersRef.current.set(msg.transferId, transfer);
                updateTransfers();
                activeTransfers.delete(msg.transferId);
                receiveBuffersRef.current.delete(msg.transferId);
                transferTimeoutsRef.current.delete(msg.transferId);
                console.error(`[FileReceiver] Receive timeout for ${msg.transferId}`);
              }
            }, TRANSFER_TIMEOUT_MS);

            transferTimeoutsRef.current.set(msg.transferId, timeoutHandle);
          } else if (msg.type === FILE_MESSAGE_TYPES.FILE_CHUNK) {
            // Chunk header received - add to queue for this transfer
            const transferData = activeTransfers.get(msg.transferId);
            if (transferData) {
              transferData.pendingChunkHeaders.push({
                chunkIndex: msg.chunkIndex,
                timestamp: Date.now(),
              });
            } else {
              console.warn(
                `[FileReceiver] Received chunk header for unknown transfer ${msg.transferId}`
              );
            }
          } else if (msg.type === FILE_MESSAGE_TYPES.FILE_COMPLETE) {
            // File transfer complete, assemble the file
            const transferData = activeTransfers.get(msg.transferId);

            if (transferData) {
              const { transfer, chunks, pendingChunkHeaders } = transferData;

              // Check for unprocessed chunk headers (indicates lost data)
              if (pendingChunkHeaders.length > 0) {
                console.warn(
                  `[FileReceiver] ${pendingChunkHeaders.length} chunk headers without data for ${msg.transferId}`
                );
              }

              // Find missing chunks for detailed error reporting
              const missingChunks = [];
              for (let i = 0; i < transfer.totalChunks; i++) {
                if (!chunks.has(i)) {
                  missingChunks.push(i);
                }
              }

              if (missingChunks.length > 0) {
                console.error(
                  `[FileReceiver] Missing ${missingChunks.length} chunks for ${msg.transferId}: [${missingChunks.slice(0, 10).join(", ")}${missingChunks.length > 10 ? "..." : ""}]`
                );
                transfer.status = TRANSFER_STATUS.FAILED;
                transfer.error = `Missing ${missingChunks.length} chunk(s): ${missingChunks.slice(0, 5).join(", ")}${missingChunks.length > 5 ? "..." : ""}`;
                transfersRef.current.set(msg.transferId, transfer);
                updateTransfers();
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

              transfer.status = TRANSFER_STATUS.COMPLETED;
              transfer.progress = 100;
              transfersRef.current.set(msg.transferId, transfer);
              updateTransfers();

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

              // Don't auto-cleanup - keep completed transfers visible at 100%
              // User can manually clear via clearCompletedTransfers if needed
              // scheduleCleanup(msg.transferId);
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
              updateTransfers();
              break;
            }
          }
        }
      };

      return messageHandler;
    },
    [transfersRef, updateTransfers, receiveBuffersRef, transferTimeoutsRef, cleanupTimeoutsRef]
  );

  /**
   * Setup data channel for receiving files (legacy method - attaches listener directly)
   * For new code, prefer createMessageHandler with registerMessageCallback
   */
  const setupReceiver = useCallback(
    (dataChannel, onFileReceived, onFileRequest) => {
      const messageHandler = createMessageHandler(onFileReceived, onFileRequest);

      dataChannel.addEventListener("message", messageHandler);

      return () => {
        dataChannel.removeEventListener("message", messageHandler);
      };
    },
    [createMessageHandler]
  );

  return { createMessageHandler, setupReceiver };
}
