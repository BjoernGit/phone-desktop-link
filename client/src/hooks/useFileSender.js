import { useCallback, useRef } from "react";
import {
  FILE_TRANSFER_CONFIG,
  TRANSFER_STATUS,
  FILE_MESSAGE_TYPES,
} from "../config/fileTransfer";

const {
  CHUNK_SIZE,
  MAX_BUFFERED_AMOUNT,
  MAX_FILE_SIZE,
  TRANSFER_TIMEOUT_MS,
  TRANSFER_CLEANUP_DELAY_MS,
  BACKPRESSURE_BASE_DELAY_MS,
  BACKPRESSURE_MAX_DELAY_MS,
  BACKPRESSURE_MULTIPLIER,
} = FILE_TRANSFER_CONFIG;

/**
 * Generate unique transfer ID with good collision resistance
 */
function generateTransferId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const timestamp = Date.now();
  const perfNow = performance.now().toString().replace(".", "");
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${perfNow}-${random}`;
}

/**
 * Hook for sending files via WebRTC DataChannel
 * Handles chunking, backpressure control, and progress tracking
 *
 * @param {Object} options
 * @param {React.MutableRefObject<Map>} options.transfersRef - Shared ref for transfer states
 * @param {Function} options.updateTransfers - Function to trigger state update
 * @param {React.MutableRefObject<Map>} options.transferTimeoutsRef - Shared ref for timeout handles
 * @param {React.MutableRefObject<Map>} options.cleanupTimeoutsRef - Shared ref for cleanup handles
 */
export function useFileSender({
  transfersRef,
  updateTransfers,
  transferTimeoutsRef,
  cleanupTimeoutsRef,
}) {
  const sendFile = useCallback(
    async (file, dataChannel, peerUuid, onProgress, fileId = null) => {
      if (!dataChannel || dataChannel.readyState !== "open") {
        throw new Error("Data channel is not open");
      }

      if (file.size > MAX_FILE_SIZE) {
        throw new Error(
          `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / (1024 * 1024)} MB`
        );
      }

      const transferId = generateTransferId();
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      // Send file metadata first (include fileId for receiver to track)
      const metadata = {
        type: FILE_MESSAGE_TYPES.FILE_START,
        transferId,
        fileId, // Original file ID for progress tracking on receiver side
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
        status: TRANSFER_STATUS.SENDING,
      };
      transfersRef.current.set(transferId, transferState);
      updateTransfers();

      // Send file in chunks with backpressure control
      let offset = 0;
      let chunkIndex = 0;
      let cancelled = false;
      let backpressureDelay = BACKPRESSURE_BASE_DELAY_MS;

      // Set transfer timeout
      const timeoutHandle = setTimeout(() => {
        cancelled = true;
        transferState.status = TRANSFER_STATUS.TIMEOUT;
        transfersRef.current.set(transferId, transferState);
        updateTransfers();
        console.error(`[FileSender] Transfer ${transferId} timed out`);
      }, TRANSFER_TIMEOUT_MS);

      transferTimeoutsRef.current.set(transferId, timeoutHandle);

      // Schedule cleanup after completion
      const scheduleCleanup = () => {
        const cleanupHandle = setTimeout(() => {
          transfersRef.current.delete(transferId);
          updateTransfers();
          cleanupTimeoutsRef.current.delete(transferId);
        }, TRANSFER_CLEANUP_DELAY_MS);
        cleanupTimeoutsRef.current.set(transferId, cleanupHandle);
      };

      const sendNextChunk = async () => {
        if (cancelled) {
          clearTimeout(timeoutHandle);
          transferTimeoutsRef.current.delete(transferId);
          return;
        }

        if (dataChannel.readyState !== "open") {
          transferState.status = TRANSFER_STATUS.FAILED;
          transferState.error = "DataChannel closed during transfer";
          transfersRef.current.set(transferId, transferState);
          updateTransfers();
          clearTimeout(timeoutHandle);
          transferTimeoutsRef.current.delete(transferId);
          return;
        }

        // Adaptive backpressure - exponential backoff when buffer is full
        if (dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
          backpressureDelay = Math.min(
            backpressureDelay * BACKPRESSURE_MULTIPLIER,
            BACKPRESSURE_MAX_DELAY_MS
          );
          setTimeout(sendNextChunk, backpressureDelay);
          return;
        } else {
          backpressureDelay = BACKPRESSURE_BASE_DELAY_MS;
        }

        if (offset >= file.size) {
          // Transfer complete
          const completeMsg = {
            type: FILE_MESSAGE_TYPES.FILE_COMPLETE,
            transferId,
          };
          dataChannel.send(JSON.stringify(completeMsg));

          transferState.status = TRANSFER_STATUS.COMPLETED;
          transferState.progress = 100;
          transfersRef.current.set(transferId, transferState);
          updateTransfers();

          if (onProgress) onProgress(transferState);

          clearTimeout(timeoutHandle);
          transferTimeoutsRef.current.delete(transferId);

          // Don't auto-cleanup - keep completed transfers visible at 100%
          // scheduleCleanup();
          return;
        }

        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const arrayBuffer = await chunk.arrayBuffer();

        // Send chunk header with index for ordering
        const header = {
          type: FILE_MESSAGE_TYPES.FILE_CHUNK,
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
        updateTransfers();

        if (onProgress) onProgress(transferState);

        // Schedule next chunk immediately (backpressure will control rate)
        setTimeout(sendNextChunk, 0);
      };

      await sendNextChunk();
      return transferId;
    },
    [transfersRef, updateTransfers, transferTimeoutsRef, cleanupTimeoutsRef]
  );

  return { sendFile };
}
