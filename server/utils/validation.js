/**
 * Validation Utilities
 * Input validation functions for socket events
 */

const crypto = require("crypto");

/**
 * Validate session ID format
 * @param {string} id
 * @returns {boolean}
 */
function isValidSessionId(id) {
  return typeof id === "string" && id.length >= 8 && id.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Validate role
 * @param {string} role
 * @returns {boolean}
 */
function isValidRole(role) {
  return role === "mobile" || role === "desktop";
}

/**
 * Validate UUID format
 * @param {string} id
 * @returns {boolean}
 */
function isValidUuid(id) {
  return typeof id === "string" && id.length >= 6 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Validate Base64URL string
 * @param {string} str
 * @param {number} minLen
 * @param {number} maxLen
 * @returns {boolean}
 */
function isValidBase64Url(str, minLen = 8, maxLen = 8192) {
  if (typeof str !== "string") return false;
  if (str.length < minLen || str.length > maxLen) return false;
  return /^[A-Za-z0-9_-]+$/.test(str);
}

/**
 * Validate MIME type for images
 * @param {string} mime
 * @returns {boolean}
 */
function isValidMime(mime) {
  return typeof mime === "string" && /^image\//.test(mime) && mime.length < 64;
}

/**
 * Validate encrypted payload structure
 * @param {Object} enc
 * @returns {boolean}
 */
function isValidEncPayload(enc) {
  if (!enc) return false;
  const { iv, ciphertext } = enc;
  return isValidBase64Url(iv, 8, 256) && isValidBase64Url(ciphertext, 16, 8192);
}

/**
 * Validate HMAC signature
 * @param {string} seedBase64Url
 * @param {string} payload
 * @param {string} signature
 * @returns {boolean}
 */
function hmacValid(seedBase64Url, payload, signature) {
  if (!seedBase64Url || !signature) return false;
  try {
    const base64 = seedBase64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const key = Buffer.from(padded, "base64");
    const mac = crypto.createHmac("sha256", key).update(payload).digest("base64url");
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(signature));
  } catch {
    return false;
  }
}

module.exports = {
  isValidSessionId,
  isValidRole,
  isValidUuid,
  isValidBase64Url,
  isValidMime,
  isValidEncPayload,
  hmacValid,
};
