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
  TRANSFER_TIMEOUT_MS: 10 * 60 * 1000, // 10 minutes (increased for larger files)
  TRANSFER_CLEANUP_DELAY_MS: 30 * 1000, // 30 seconds after completion

  // Backpressure control
  BACKPRESSURE_BASE_DELAY_MS: 5, // Base delay in ms
  BACKPRESSURE_MAX_DELAY_MS: 100, // Max delay in ms
  BACKPRESSURE_MULTIPLIER: 1.5, // Exponential backoff multiplier
};

// Transfer status constants
export const TRANSFER_STATUS = {
  SENDING: "sending",
  RECEIVING: "receiving",
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
