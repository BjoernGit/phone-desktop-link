/**
 * File Transfer Configuration
 * Centralized constants for WebRTC file transfers
 */

export const FILE_TRANSFER_CONFIG = {
  // Chunk settings
  CHUNK_SIZE: 16384, // 16 KB (recommended for WebRTC)
  MAX_BUFFERED_AMOUNT: 256 * 1024, // 256 KB - threshold before pausing

  // File limits
  MAX_FILE_SIZE: 2 * 1024 * 1024 * 1024, // 2 GB max file size

  // Timeouts
  // Inactivity window: reset on every chunk, so a slow but moving transfer
  // never dies - only one with no data at all for this long
  TRANSFER_TIMEOUT_MS: 10 * 60 * 1000, // 10 minutes without any chunk
  TRANSFER_CLEANUP_DELAY_MS: 30 * 1000, // 30 seconds after completion

  // Stall detection: no chunk for this long flips a receiving transfer to
  // "stalled" so the UI can say "interrupted" without waiting for any
  // network event (revoke messages can lag many seconds behind the data)
  STALL_DETECT_MS: 3000,

  // Backpressure control
  BACKPRESSURE_BASE_DELAY_MS: 5, // Base delay in ms
  BACKPRESSURE_MAX_DELAY_MS: 100, // Max delay in ms
  BACKPRESSURE_MULTIPLIER: 1.5, // Exponential backoff multiplier

  // Retry settings
  MAX_RETRY_ATTEMPTS: 3, // Maximum number of retry attempts
  RETRY_DELAY_MS: 2000, // Base delay between retries (doubles each attempt)
};

// Transfer status constants
export const TRANSFER_STATUS = {
  SENDING: "sending",
  RECEIVING: "receiving",
  STALLED: "stalled", // Receiving, but no data has arrived for STALL_DETECT_MS
  COMPLETED: "completed",
  FAILED: "failed",
  TIMEOUT: "timeout",
  REVOKED: "revoked", // Sender revoked the file mid-transfer
};

// Message types for WebRTC file transfer protocol
export const FILE_MESSAGE_TYPES = {
  FILE_START: "file-start",
  FILE_CHUNK: "file-chunk",
  FILE_COMPLETE: "file-complete",
  FILE_REQUEST: "file-request",
  FILE_NOT_FOUND: "file-not-found", // Sent when requested file is no longer available
  FILE_REVOKED: "file-revoked", // Sender revoked the file mid-transfer
};
