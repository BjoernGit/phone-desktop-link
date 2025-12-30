/**
 * Security Configuration
 * Centralized security-related constants for the client
 */

/**
 * QR Code Time-To-Live in milliseconds (10 minutes)
 * QR codes containing session data expire after this duration
 */
export const QR_TTL_MS = 10 * 60 * 1000;

/**
 * Status message auto-dismiss delay in milliseconds
 */
export const STATUS_DISMISS_MS = 3000;

/**
 * Session-related status message dismiss delay in milliseconds
 */
export const SESSION_STATUS_DISMISS_MS = 2000;
