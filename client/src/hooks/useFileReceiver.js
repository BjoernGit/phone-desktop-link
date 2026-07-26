import { useCallback } from "react";
import {
  FILE_TRANSFER_CONFIG,
  TRANSFER_STATUS,
  FILE_MESSAGE_TYPES,
} from "../config/fileTransfer";
import {
  storeChunk,
  assembleChunksToBlob,
  deleteTransfer,
  getChunkCount,
} from "../utils/transferDB";

const {
  MAX_FILE_SIZE,
  TRANSFER_TIMEOUT_MS,
  TRANSFER_CLEANUP_DELAY_MS,
  STALL_DETECT_MS,
} = FILE_TRANSFER_CONFIG;

/**
 * Validate incoming file transfer message
 * @param {Object} msg - The message to validate
 * @param {string} expectedType - The expected message type
 * @returns {{ valid: boolean, error?: string }}
 */
function validateMessage(msg, expectedType) {
  if (!msg || typeof msg !== "object") {
    return { valid: false, error: "Invalid message format" };
  }

  if (msg.type !== expectedType) {
    return { valid: false, error: `Expected type ${expectedType}, got ${msg.type}` };
  }

  switch (expectedType) {
    case FILE_MESSAGE_TYPES.FILE_START:
      if (typeof msg.transferId !== "string" || msg.transferId.length === 0) {
        return { valid: false, error: "Invalid transferId" };
      }
      if (typeof msg.fileName !== "string" || msg.fileName.length === 0) {
        return { valid: false, error: "Invalid fileName" };
      }
      if (typeof msg.fileSize !== "number" || msg.fileSize <= 0) {
        return { valid: false, error: "Invalid fileSize" };
      }
      if (typeof msg.totalChunks !== "number" || msg.totalChunks <= 0) {
        return { valid: false, error: "Invalid totalChunks" };
      }
      break;

    case FILE_MESSAGE_TYPES.FILE_CHUNK:
      if (typeof msg.transferId !== "string" || msg.transferId.length === 0) {
        return { valid: false, error: "Invalid transferId" };
      }
      if (typeof msg.chunkIndex !== "number" || msg.chunkIndex < 0) {
        return { valid: false, error: "Invalid chunkIndex" };
      }
      break;

    case FILE_MESSAGE_TYPES.FILE_COMPLETE:
    case FILE_MESSAGE_TYPES.FILE_REVOKED:
      if (typeof msg.transferId !== "string" || msg.transferId.length === 0) {
        return { valid: false, error: "Invalid transferId" };
      }
      break;

    case FILE_MESSAGE_TYPES.FILE_REQUEST:
      if (typeof msg.fileId !== "string" || msg.fileId.length === 0) {
        return { valid: false, error: "Invalid fileId" };
      }
      break;

    case FILE_MESSAGE_TYPES.FILE_NOT_FOUND:
      if (typeof msg.fileId !== "string" || msg.fileId.length === 0) {
        return { valid: false, error: "Invalid fileId" };
      }
      break;
  }

  return { valid: true };
}

/**
 * Hook for receiving files via WebRTC DataChannel
 * Handles chunk reassembly, out-of-order handling, and progress tracking
 * Uses IndexedDB for chunk storage to prevent memory issues on mobile
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
   * @param {Function} onFileRevoked - Callback when sender revokes a file mid-transfer
   */
  const createMessageHandler = useCallback(
    (onFileReceived, onFileRequest, onFileNotFound, onFileRevoked) => {
      // transferId -> { transfer, pendingChunkHeader, receivedChunkCount }
      // Note: Chunks are stored in IndexedDB, not in memory
      const activeTransfers = new Map();

      // Short local watchdogs: no chunk for STALL_DETECT_MS flips the transfer
      // to "stalled" so the UI reacts without waiting for any network event
      const stallTimers = new Map();

      const clearStallTimer = (transferId) => {
        const handle = stallTimers.get(transferId);
        if (handle) {
          clearTimeout(handle);
          stallTimers.delete(transferId);
        }
      };

      const armStallTimer = (transferId) => {
        clearStallTimer(transferId);
        stallTimers.set(
          transferId,
          setTimeout(() => {
            stallTimers.delete(transferId);
            const transferData = activeTransfers.get(transferId);
            if (!transferData) return;
            const { transfer } = transferData;
            if (transfer.status !== TRANSFER_STATUS.RECEIVING) return;
            console.warn(`[FileReceiver] Transfer ${transferId} stalled - no data for ${STALL_DETECT_MS}ms`);
            transfer.status = TRANSFER_STATUS.STALLED;
            transfersRef.current.set(transferId, transfer);
            updateTransfers();
          }, STALL_DETECT_MS)
        );
      };

      // Inactivity timeout: re-armed on every chunk, so only a transfer with
      // no data at all for TRANSFER_TIMEOUT_MS dies - never a slow one
      const armInactivityTimeout = (transferId) => {
        const existing = transferTimeoutsRef.current.get(transferId);
        if (existing) clearTimeout(existing);
        const timeoutHandle = setTimeout(async () => {
          if (activeTransfers.has(transferId)) {
            const { transfer } = activeTransfers.get(transferId);
            transfer.status = TRANSFER_STATUS.TIMEOUT;
            transfersRef.current.set(transferId, transfer);
            updateTransfers();
            activeTransfers.delete(transferId);
            receiveBuffersRef.current.delete(transferId);
            clearStallTimer(transferId);
            await cleanupTransferData(transferId);
            transferTimeoutsRef.current.delete(transferId);
            console.error(`[FileReceiver] Receive timeout for ${transferId}`);
          }
        }, TRANSFER_TIMEOUT_MS);
        transferTimeoutsRef.current.set(transferId, timeoutHandle);
      };

      // Clean up IndexedDB data for a transfer
      const cleanupTransferData = async (transferId) => {
        try {
          await deleteTransfer(transferId);
        } catch (e) {
          console.warn(`[FileReceiver] Failed to cleanup IndexedDB for ${transferId}:`, e);
        }
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
          if (msg.type === FILE_MESSAGE_TYPES.FILE_REQUEST) {
            const validation = validateMessage(msg, FILE_MESSAGE_TYPES.FILE_REQUEST);
            if (!validation.valid) {
              console.warn(`[FileReceiver] Invalid file-request: ${validation.error}`);
              return;
            }
            if (onFileRequest) {
              console.log(`[FileReceiver] Received file-request for ${msg.fileId}`);
              onFileRequest(msg.fileId);
            }
            return;
          }

          // Handle file-not-found (receiver side) - file was deleted before transfer
          if (msg.type === FILE_MESSAGE_TYPES.FILE_NOT_FOUND) {
            const validation = validateMessage(msg, FILE_MESSAGE_TYPES.FILE_NOT_FOUND);
            if (!validation.valid) {
              console.warn(`[FileReceiver] Invalid file-not-found: ${validation.error}`);
              return;
            }
            if (onFileNotFound) {
              console.warn(`[FileReceiver] File not found: ${msg.fileId} - ${msg.fileName}`);
              onFileNotFound(msg.fileId, msg.fileName);
            }
            return;
          }

          // Handle file-revoked (receiver side) - sender revoked file mid-transfer
          if (msg.type === FILE_MESSAGE_TYPES.FILE_REVOKED) {
            const validation = validateMessage(msg, FILE_MESSAGE_TYPES.FILE_REVOKED);
            if (!validation.valid) {
              console.warn(`[FileReceiver] Invalid file-revoked: ${validation.error}`);
              return;
            }

            console.warn(`[FileReceiver] File revoked by sender: ${msg.fileId} - ${msg.fileName}`);

            const transferData = activeTransfers.get(msg.transferId);
            if (transferData) {
              const { transfer } = transferData;

              // Update transfer status to revoked
              transfer.status = TRANSFER_STATUS.REVOKED;
              transfersRef.current.set(msg.transferId, transfer);
              updateTransfers();

              // Clean up: delete all buffered chunks from IndexedDB
              activeTransfers.delete(msg.transferId);
              receiveBuffersRef.current.delete(msg.transferId);
              await cleanupTransferData(msg.transferId);

              // Clear watchdogs
              clearStallTimer(msg.transferId);
              const timeoutHandle = transferTimeoutsRef.current.get(msg.transferId);
              if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                transferTimeoutsRef.current.delete(msg.transferId);
              }

              console.log(`[FileReceiver] Cleaned up revoked transfer ${msg.transferId}, discarded partial data`);
            }

            // Notify callback
            if (onFileRevoked) {
              onFileRevoked(msg.fileId, msg.fileName, msg.transferId);
            }
            return;
          }

          if (msg.type === FILE_MESSAGE_TYPES.FILE_START) {
            const validation = validateMessage(msg, FILE_MESSAGE_TYPES.FILE_START);
            if (!validation.valid) {
              console.error(`[FileReceiver] Invalid file-start: ${validation.error}`);
              return;
            }

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
              fileType: msg.fileType || "application/octet-stream",
              totalChunks: msg.totalChunks,
              receivedChunks: 0,
              progress: 0,
              status: TRANSFER_STATUS.RECEIVING,
            };

            // Store transfer state with pending chunk header (one at a time per transfer)
            // This fixes the race condition - each transfer tracks its own pending header
            activeTransfers.set(msg.transferId, {
              transfer: currentTransfer,
              pendingChunkHeader: null, // Will hold { chunkIndex, timestamp } when header received
              receivedChunkCount: 0,
            });

            // Keep a simple counter in receiveBuffersRef for compatibility
            receiveBuffersRef.current.set(msg.transferId, { count: 0 });

            transfersRef.current.set(msg.transferId, currentTransfer);
            updateTransfers();

            // Watchdogs: both re-armed on every chunk
            armInactivityTimeout(msg.transferId);
            armStallTimer(msg.transferId);

          } else if (msg.type === FILE_MESSAGE_TYPES.FILE_CHUNK) {
            const validation = validateMessage(msg, FILE_MESSAGE_TYPES.FILE_CHUNK);
            if (!validation.valid) {
              console.warn(`[FileReceiver] Invalid file-chunk: ${validation.error}`);
              return;
            }

            // Chunk header received - store it for THIS specific transfer
            // This fixes the race condition by using transferId from the message
            const transferData = activeTransfers.get(msg.transferId);
            if (transferData) {
              // Store the pending header for this specific transfer
              transferData.pendingChunkHeader = {
                chunkIndex: msg.chunkIndex,
                timestamp: Date.now(),
              };
            } else {
              console.warn(
                `[FileReceiver] Received chunk header for unknown transfer ${msg.transferId}`
              );
            }

          } else if (msg.type === FILE_MESSAGE_TYPES.FILE_COMPLETE) {
            const validation = validateMessage(msg, FILE_MESSAGE_TYPES.FILE_COMPLETE);
            if (!validation.valid) {
              console.warn(`[FileReceiver] Invalid file-complete: ${validation.error}`);
              return;
            }

            // File transfer complete, assemble the file from IndexedDB
            const transferData = activeTransfers.get(msg.transferId);

            if (transferData) {
              const { transfer, pendingChunkHeader } = transferData;

              // Check for unprocessed chunk header (indicates lost data)
              if (pendingChunkHeader !== null) {
                console.warn(
                  `[FileReceiver] Pending chunk header without data for ${msg.transferId}`
                );
              }

              // Verify chunk count in IndexedDB
              let actualChunkCount;
              try {
                actualChunkCount = await getChunkCount(msg.transferId);
              } catch (e) {
                console.error(`[FileReceiver] Failed to get chunk count:`, e);
                transfer.status = TRANSFER_STATUS.FAILED;
                transfer.error = "Failed to verify chunks in storage";
                transfersRef.current.set(msg.transferId, transfer);
                updateTransfers();
                activeTransfers.delete(msg.transferId);
                receiveBuffersRef.current.delete(msg.transferId);
                await cleanupTransferData(msg.transferId);
                return;
              }

              if (actualChunkCount !== transfer.totalChunks) {
                const missingCount = transfer.totalChunks - actualChunkCount;
                console.error(
                  `[FileReceiver] Missing ${missingCount} chunks for ${msg.transferId} (got ${actualChunkCount}/${transfer.totalChunks})`
                );
                transfer.status = TRANSFER_STATUS.FAILED;
                transfer.error = `Missing ${missingCount} chunk(s)`;
                transfersRef.current.set(msg.transferId, transfer);
                updateTransfers();
                activeTransfers.delete(msg.transferId);
                receiveBuffersRef.current.delete(msg.transferId);
                await cleanupTransferData(msg.transferId);

                // Clear watchdogs
                clearStallTimer(msg.transferId);
                const timeoutHandle = transferTimeoutsRef.current.get(msg.transferId);
                if (timeoutHandle) {
                  clearTimeout(timeoutHandle);
                  transferTimeoutsRef.current.delete(msg.transferId);
                }
                return;
              }

              // All chunks present, assemble file from IndexedDB
              let blob;
              try {
                blob = await assembleChunksToBlob(
                  msg.transferId,
                  transfer.totalChunks,
                  transfer.fileType
                );
              } catch (e) {
                console.error(`[FileReceiver] Failed to assemble file:`, e);
                transfer.status = TRANSFER_STATUS.FAILED;
                transfer.error = "Failed to assemble file from chunks";
                transfersRef.current.set(msg.transferId, transfer);
                updateTransfers();
                activeTransfers.delete(msg.transferId);
                receiveBuffersRef.current.delete(msg.transferId);
                await cleanupTransferData(msg.transferId);
                return;
              }

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

              // Clean up IndexedDB after successful transfer
              await cleanupTransferData(msg.transferId);

              // Clear watchdogs
              clearStallTimer(msg.transferId);
              const timeoutHandle = transferTimeoutsRef.current.get(msg.transferId);
              if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                transferTimeoutsRef.current.delete(msg.transferId);
              }
            }
          }
        } else if (event.data instanceof ArrayBuffer) {
          // Chunk data received - find the transfer with a pending header
          // Since DataChannel is ordered and each transfer tracks its own pending header,
          // we iterate and find the one with a non-null pendingChunkHeader
          for (const [transferId, transferData] of activeTransfers.entries()) {
            const { transfer, pendingChunkHeader } = transferData;

            // Check if this transfer has a pending chunk header
            if (pendingChunkHeader !== null) {
              const chunkIndex = pendingChunkHeader.chunkIndex;

              // Clear the pending header immediately
              transferData.pendingChunkHeader = null;

              // Store chunk in IndexedDB instead of RAM
              try {
                await storeChunk(transferId, chunkIndex, event.data);
              } catch (e) {
                console.error(`[FileReceiver] Failed to store chunk ${chunkIndex}:`, e);
                // Continue anyway - the completion check will catch missing chunks
              }

              // Update progress
              transferData.receivedChunkCount++;
              transfer.receivedChunks = transferData.receivedChunkCount;
              transfer.progress = Math.min(
                100,
                Math.round((transfer.receivedChunks / transfer.totalChunks) * 100)
              );

              // Data is flowing (again): recover from a stall and push both
              // watchdogs out
              if (transfer.status === TRANSFER_STATUS.STALLED) {
                transfer.status = TRANSFER_STATUS.RECEIVING;
              }
              armInactivityTimeout(transferId);
              armStallTimer(transferId);

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
