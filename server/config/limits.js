/**
 * Server configuration constants
 * Centralized limits and thresholds for rate limiting, security, and file transfers
 */

module.exports = {
  // =============================================================================
  // CORS & Origins
  // =============================================================================
  ALLOWED_ORIGINS: [
    "https://filebeacon.net",
    "https://www.filebeacon.net",
    "https://filebeacon-dev.onrender.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ],

  // =============================================================================
  // Socket.io Configuration
  // =============================================================================
  MAX_HTTP_BUFFER_SIZE: 10 * 1024 * 1024, // 10 MB - for larger images

  // =============================================================================
  // Security & Banning
  // =============================================================================
  NONCE_TTL_MS: 5 * 60 * 1000,           // 5 minutes - offer nonce validity
  BAN_DURATION_MS: 15 * 60 * 1000,       // 15 minutes - ban duration
  BAN_THRESHOLD: 5,                       // strikes before ban

  // =============================================================================
  // Rate Limits - Joins
  // =============================================================================
  JOIN_LIMIT: 10,                         // joins per window per IP
  JOIN_WINDOW_MS: 60 * 1000,              // 1 minute window

  // =============================================================================
  // Rate Limits - Photos
  // =============================================================================
  PHOTO_LIMIT_PER_IP: 20,                 // photos per minute per IP
  PHOTO_LIMIT_PER_SESSION: 120,           // photos per minute per session
  PHOTO_WINDOW_MS: 60 * 1000,             // 1 minute window

  // =============================================================================
  // Rate Limits - Session Offers
  // =============================================================================
  OFFER_LIMIT_PER_IP: 10,                 // offers per minute per IP
  OFFER_LIMIT_PER_SESSION: 60,            // offers per minute per session
  OFFER_WINDOW_MS: 60 * 1000,             // 1 minute window

  // =============================================================================
  // Rate Limits - File Transfers (Socket.io fallback)
  // =============================================================================
  SOCKETIO_MAX_FILE_SIZE: 30 * 1024 * 1024,       // 30 MB - max single file size
  SOCKETIO_TRANSFER_LIMIT_BYTES: 100 * 1024 * 1024, // 100 MB per minute per IP
  SOCKETIO_TRANSFER_WINDOW_MS: 60 * 1000,         // 1 minute window
  MAX_CONCURRENT_TRANSFERS: 3,                     // concurrent transfers per IP

  // =============================================================================
  // Validation Limits
  // =============================================================================
  MAX_CIPHER_BASE64: 8_000_000,           // ~6-7 MB decoded - max encrypted photo size
  SESSION_ID_MIN_LENGTH: 8,
  SESSION_ID_MAX_LENGTH: 32,
  UUID_MIN_LENGTH: 6,
  UUID_MAX_LENGTH: 64,
};
