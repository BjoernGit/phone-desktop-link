/**
 * Error Handler Utility
 * Centralized error handling and user notification
 */

/**
 * @typedef {'error' | 'warning' | 'info' | 'success'} NotificationType
 */

/**
 * Log levels for console output
 */
const LOG_LEVELS = {
  error: console.error,
  warning: console.warn,
  info: console.info,
  success: console.log,
};

/**
 * Show notification to user (non-blocking)
 * @param {string} message - The message to display
 * @param {NotificationType} [type='error'] - The notification type
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.silent=false] - If true, only log to console
 * @param {number} [options.duration=0] - Auto-dismiss duration (0 = no auto-dismiss for alerts)
 */
export function notifyUser(message, type = "error", options = {}) {
  const { silent = false } = options;
  const logFn = LOG_LEVELS[type] || console.log;

  // Always log to console with context
  logFn(`[${type.toUpperCase()}] ${message}`);

  // Show alert for errors unless silent mode
  if (!silent && type === "error") {
    // Use setTimeout to make it non-blocking
    setTimeout(() => alert(message), 0);
  }
}

/**
 * Handle file transfer errors with context
 * @param {Error} error - The error object
 * @param {string} context - Context description (e.g., "sending file", "receiving chunk")
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.silent=false] - If true, only log to console
 */
export function handleFileTransferError(error, context, options = {}) {
  const message = `File transfer failed (${context}): ${error.message}`;
  console.error(`[FileTransfer] ${context}:`, error);
  notifyUser(message, "error", options);
}

/**
 * Handle WebRTC connection errors
 * @param {Error} error - The error object
 * @param {string} peerUuid - The peer's UUID
 * @param {string} [context] - Additional context
 */
export function handleWebRTCError(error, peerUuid, context = "") {
  const contextStr = context ? ` (${context})` : "";
  console.error(`[WebRTC] Error with peer ${peerUuid}${contextStr}:`, error);
  // WebRTC errors are often transient, so we only log them
  // The connection state handlers will manage reconnection
}

/**
 * Handle socket connection errors
 * @param {Error} error - The error object
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.showAlert=true] - Whether to show an alert
 */
export function handleSocketError(error, options = {}) {
  const { showAlert = true } = options;
  console.error("[Socket] Connection error:", error);

  if (showAlert) {
    notifyUser("Connection error. Please check your network and refresh the page.", "error");
  }
}

/**
 * Handle encryption/decryption errors
 * @param {Error} error - The error object
 * @param {string} operation - The operation that failed ('encrypt' or 'decrypt')
 */
export function handleCryptoError(error, operation) {
  console.error(`[Crypto] ${operation} failed:`, error);
  // Don't alert for crypto errors - they're usually due to wrong keys
  // The UI should handle showing appropriate status
}

/**
 * Create a wrapped async function that handles errors
 * @template T
 * @param {() => Promise<T>} fn - The async function to wrap
 * @param {string} context - Error context for logging
 * @param {Object} [options] - Error handling options
 * @returns {Promise<T|null>} The result or null on error
 */
export async function withErrorHandling(fn, context, options = {}) {
  try {
    return await fn();
  } catch (error) {
    console.error(`[${context}] Error:`, error);
    if (!options.silent) {
      notifyUser(`${context}: ${error.message}`, "error", options);
    }
    return null;
  }
}
