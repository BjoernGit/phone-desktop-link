/**
 * Rate Limiting Middleware
 * Handles rate limiting, banning, and security logging
 */

const fs = require("fs");
const path = require("path");
const config = require("../config/limits");

// Rate limiter maps
const joinCounters = new Map();
const transferBytesMap = new Map();
const activeTransfersMap = new Map();
const offerNonces = new Map();
const banned = new Map();

/**
 * Create a generic rate limiter
 * @param {number} limit - Max requests per window
 * @param {number} windowMs - Time window in ms
 * @returns {Function}
 */
function createRateLimiter(limit, windowMs) {
  const map = new Map();
  return (key) => {
    if (!key) return false;
    const now = Date.now();
    const entry = map.get(key) || { count: 0, ts: now };
    const age = now - entry.ts;
    const withinWindow = age < windowMs;
    const count = withinWindow ? entry.count + 1 : 1;
    map.set(key, { count, ts: withinWindow ? entry.ts : now });
    return count <= limit;
  };
}

// Pre-configured rate limiters
const allowPhoto = createRateLimiter(config.PHOTO_LIMIT_PER_IP, config.PHOTO_WINDOW_MS);
const allowOffer = createRateLimiter(config.OFFER_LIMIT_PER_IP, config.OFFER_WINDOW_MS);
const allowPhotoSession = createRateLimiter(config.PHOTO_LIMIT_PER_SESSION, config.PHOTO_WINDOW_MS);
const allowOfferSession = createRateLimiter(config.OFFER_LIMIT_PER_SESSION, config.OFFER_WINDOW_MS);
const allowMerge = createRateLimiter(config.MERGE_LIMIT_PER_IP, config.MERGE_WINDOW_MS);
const allowMergeSession = createRateLimiter(config.MERGE_LIMIT_PER_SESSION, config.MERGE_WINDOW_MS);

// Merge locks to prevent concurrent merges on the same session
const mergeLocks = new Map();

/**
 * Acquire a merge lock for a session (prevents concurrent merges)
 * @param {string} sessionId
 * @returns {boolean} - true if lock acquired, false if already locked
 */
function acquireMergeLock(sessionId) {
  if (!sessionId) return false;
  const now = Date.now();
  const lock = mergeLocks.get(sessionId);

  if (lock && now - lock < config.MERGE_LOCK_MS) {
    return false; // Lock still active
  }

  mergeLocks.set(sessionId, now);
  return true;
}

/**
 * Release a merge lock for a session
 * @param {string} sessionId
 */
function releaseMergeLock(sessionId) {
  mergeLocks.delete(sessionId);
}

/**
 * Check if join is allowed (rate limited)
 * @param {string} ip
 * @returns {boolean}
 */
function allowJoin(ip) {
  if (!ip) return false;
  const now = Date.now();
  const entry = joinCounters.get(ip) || { count: 0, ts: now };
  const age = now - entry.ts;
  const withinWindow = age < config.JOIN_WINDOW_MS;
  const count = withinWindow ? entry.count + 1 : 1;
  joinCounters.set(ip, { count, ts: withinWindow ? entry.ts : now });
  return count <= config.JOIN_LIMIT;
}

/**
 * Check if transfer bytes are allowed (rate limited)
 * @param {string} ip
 * @param {number} bytes
 * @returns {boolean}
 */
function allowTransferBytes(ip, bytes) {
  if (!ip || typeof bytes !== "number") return false;
  const now = Date.now();
  const entry = transferBytesMap.get(ip) || { bytes: 0, ts: now };
  const age = now - entry.ts;
  const withinWindow = age < config.SOCKETIO_TRANSFER_WINDOW_MS;
  const totalBytes = withinWindow ? entry.bytes + bytes : bytes;
  transferBytesMap.set(ip, { bytes: totalBytes, ts: withinWindow ? entry.ts : now });
  return totalBytes <= config.SOCKETIO_TRANSFER_LIMIT_BYTES;
}

/**
 * Check if IP is banned
 * @param {string} ip
 * @returns {boolean}
 */
function isBanned(ip) {
  if (!ip) return false;
  const entry = banned.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    banned.delete(ip);
    return false;
  }
  return true;
}

/**
 * Register a security strike against an IP
 * @param {string} ip
 * @param {string} reason
 * @returns {boolean} - true if IP is now banned
 */
function registerStrike(ip, reason) {
  if (!ip) return false;
  const now = Date.now();
  const entry = banned.get(ip) || { strikes: 0, until: 0 };
  const strikes = entry.strikes + 1;
  if (strikes >= config.BAN_THRESHOLD) {
    banned.set(ip, { strikes, until: now + config.BAN_DURATION_MS });
    auditLog("ban", { ip, reason, strikes });
    return true;
  }
  banned.set(ip, { strikes, until: entry.until });
  auditLog("strike", { ip, reason, strikes });
  return false;
}

/**
 * Clean up expired nonces for a session
 * @param {string} sessionId
 */
function cleanupNonces(sessionId) {
  const map = offerNonces.get(sessionId);
  if (!map) return;
  const now = Date.now();
  for (const [nonce, ts] of map.entries()) {
    if (now - ts > config.NONCE_TTL_MS) map.delete(nonce);
  }
}

/**
 * Check if nonce has been seen (replay protection)
 * @param {string} sessionId
 * @param {string} nonce
 * @param {number} ts
 * @returns {boolean} - true if nonce was already seen
 */
function nonceSeen(sessionId, nonce, ts) {
  if (!sessionId || !nonce || typeof ts !== "number") return true;
  cleanupNonces(sessionId);
  const map = offerNonces.get(sessionId) || new Map();
  if (map.has(nonce)) return true;
  map.set(nonce, ts);
  offerNonces.set(sessionId, map);
  return false;
}

/**
 * Get active transfers map for an IP
 * @param {string} ip
 * @returns {Set}
 */
function getActiveTransfers(ip) {
  return activeTransfersMap.get(ip) || new Set();
}

/**
 * Track active transfer
 * @param {string} ip
 * @param {string} fileId
 */
function trackTransfer(ip, fileId) {
  const activeSet = activeTransfersMap.get(ip) || new Set();
  activeSet.add(fileId);
  activeTransfersMap.set(ip, activeSet);
}

/**
 * Remove completed transfer from tracking
 * @param {string} ip
 * @param {string} fileId
 */
function untrackTransfer(ip, fileId) {
  const activeSet = activeTransfersMap.get(ip);
  if (activeSet) {
    activeSet.delete(fileId);
    if (activeSet.size === 0) {
      activeTransfersMap.delete(ip);
    }
  }
}

/**
 * Write to security audit log
 * @param {string} event
 * @param {Object} data
 */
function auditLog(event, data) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n";
  fs.appendFile(path.join(__dirname, "..", "security.log"), line, (err) => {
    if (err) console.warn("auditLog write failed", err);
  });
}

module.exports = {
  createRateLimiter,
  allowPhoto,
  allowOffer,
  allowPhotoSession,
  allowOfferSession,
  allowMerge,
  allowMergeSession,
  acquireMergeLock,
  releaseMergeLock,
  allowJoin,
  allowTransferBytes,
  isBanned,
  registerStrike,
  nonceSeen,
  getActiveTransfers,
  trackTransfer,
  untrackTransfer,
  auditLog,
};
