/**
 * Cryptographic Utilities
 * Provides encryption, decryption, key derivation, and encoding functions
 * using the Web Crypto API (AES-GCM, HKDF, HMAC)
 */

/**
 * @typedef {Object} EncryptedPayload
 * @property {string} iv - Base64url encoded initialization vector
 * @property {string} ciphertext - Base64url encoded ciphertext
 * @property {string} [mime] - Optional MIME type for data URLs
 */

/**
 * @typedef {Object} DataUrlParts
 * @property {string} mime - The MIME type
 * @property {Uint8Array} bytes - The decoded bytes
 */

/**
 * Convert Uint8Array to standard base64 string
 * @param {Uint8Array} bytes - The bytes to encode
 * @returns {string} Base64 encoded string
 */
function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode standard base64 string to Uint8Array
 * @param {string} str - Base64 encoded string
 * @returns {Uint8Array} Decoded bytes
 */
function fromBase64(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode bytes to URL-safe base64 (no padding)
 * @param {Uint8Array} bytes - The bytes to encode
 * @returns {string} Base64url encoded string
 */
export function base64UrlEncode(bytes) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Decode URL-safe base64 string to bytes
 * @param {string} str - Base64url encoded string
 * @returns {Uint8Array} Decoded bytes
 */
export function base64UrlDecode(str) {
  const padLength = (4 - (str.length % 4)) % 4;
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLength);
  return fromBase64(padded);
}

/**
 * Convert string to UTF-8 encoded bytes
 * @param {string} str - The string to encode
 * @returns {Uint8Array} UTF-8 encoded bytes
 */
function stringToBytes(str) {
  return new TextEncoder().encode(str);
}

/**
 * Generate a cryptographically secure random seed
 * @param {number} [lenBytes=16] - Length in bytes (default: 16 = 128 bits)
 * @returns {string} Base64url encoded seed
 */
export function generateSeedBase64Url(lenBytes = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(lenBytes));
  return base64UrlEncode(bytes);
}

/**
 * Derive an AES-GCM key from a seed using HKDF
 * @param {string} seedBase64Url - Base64url encoded seed
 * @param {string} [sessionId=''] - Optional session ID for key derivation info
 * @returns {Promise<CryptoKey>} The derived AES-GCM key
 */
export async function deriveAesKeyFromSeed(seedBase64Url, sessionId = "") {
  const seedBytes = base64UrlDecode(seedBase64Url);
  const encoder = new TextEncoder();
  const info = encoder.encode(sessionId || "");
  const salt = new Uint8Array(16); // zero salt for now (sessionId in info)
  const hkdfKey = await crypto.subtle.importKey("raw", seedBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    hkdfKey,
    { name: "AES-GCM", length: 128 },
    true, // allow export for debug/telemetry display
    ["encrypt", "decrypt"]
  );
}

/**
 * Export an AES key as a base64url string
 * @param {CryptoKey} key - The AES key to export
 * @returns {Promise<string>} Base64url encoded raw key bytes
 */
export async function exportAesKeyBase64Url(key) {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return base64UrlEncode(raw);
}

/**
 * Parse a data URL into MIME type and bytes
 * @param {string} dataUrl - The data URL to parse
 * @returns {DataUrlParts} Object containing mime type and bytes
 * @throws {Error} If the data URL is invalid
 */
function dataUrlToBytes(dataUrl) {
  const parts = dataUrl.split(",");
  if (parts.length < 2) throw new Error("Invalid data URL");
  const mimeMatch = parts[0].match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const bytes = fromBase64(parts[1]);
  return { mime, bytes };
}

/**
 * Convert bytes to a data URL
 * @param {Uint8Array} bytes - The bytes to encode
 * @param {string} [mime='image/jpeg'] - The MIME type
 * @returns {string} The data URL
 */
function bytesToDataUrl(bytes, mime = "image/jpeg") {
  return `data:${mime};base64,${toBase64(bytes)}`;
}

/**
 * Encrypt a data URL using AES-GCM
 * @param {string} dataUrl - The data URL to encrypt
 * @param {CryptoKey} key - The AES-GCM key
 * @returns {Promise<EncryptedPayload>} The encrypted payload
 * @throws {Error} If the key is missing
 */
export async function encryptDataUrl(dataUrl, key) {
  if (!key) throw new Error("Missing key");
  const { mime, bytes } = dataUrlToBytes(dataUrl);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  const cipherBytes = new Uint8Array(cipherBuf);
  return {
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(cipherBytes),
    mime,
  };
}

/**
 * Decrypt an encrypted payload back to a data URL
 * @param {EncryptedPayload} payload - The encrypted payload
 * @param {CryptoKey} key - The AES-GCM key
 * @returns {Promise<string>} The decrypted data URL
 * @throws {Error} If the key or payload is missing/invalid
 */
export async function decryptToDataUrl(payload, key) {
  if (!key) throw new Error("Missing key");
  const { iv, ciphertext, mime } = payload;
  if (!iv || !ciphertext) throw new Error("Missing cipher payload");
  const ivBytes = base64UrlDecode(iv);
  const cipherBytes = base64UrlDecode(ciphertext);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, cipherBytes);
  const plainBytes = new Uint8Array(plainBuf);
  return bytesToDataUrl(plainBytes, mime || "image/jpeg");
}

/**
 * Create an HMAC-SHA256 signature
 * @param {string} message - The message to sign
 * @param {string} seedBase64Url - Base64url encoded key material
 * @returns {Promise<string>} Base64url encoded signature
 */
export async function hmacSignBase64Url(message, seedBase64Url) {
  if (!message || !seedBase64Url) return "";
  const keyBytes = base64UrlDecode(seedBase64Url);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, stringToBytes(message));
  return base64UrlEncode(new Uint8Array(sigBuf));
}

/**
 * Encrypt a JSON object with a shared secret
 * @param {string} secretBase64Url - Base64url encoded shared secret
 * @param {Object} payload - The JSON payload to encrypt
 * @param {string} [info='offer-share'] - Key derivation info string
 * @returns {Promise<EncryptedPayload>} The encrypted payload (iv + ciphertext)
 * @throws {Error} If secret or payload is missing
 */
export async function encryptJsonWithSecret(secretBase64Url, payload, info = "offer-share") {
  if (!secretBase64Url || !payload) throw new Error("Missing secret or payload");
  const key = await deriveAesKeyFromSeed(secretBase64Url, info);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = stringToBytes(JSON.stringify(payload));
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return {
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(cipherBuf)),
  };
}

/**
 * Decrypt a JSON object with a shared secret
 * @param {string} secretBase64Url - Base64url encoded shared secret
 * @param {EncryptedPayload} encPayload - The encrypted payload
 * @param {string} [info='offer-share'] - Key derivation info string
 * @returns {Promise<Object>} The decrypted JSON object
 * @throws {Error} If secret or payload is missing/invalid
 */
export async function decryptJsonWithSecret(secretBase64Url, encPayload, info = "offer-share") {
  if (!secretBase64Url || !encPayload?.iv || !encPayload?.ciphertext) throw new Error("Missing secret or payload");
  const key = await deriveAesKeyFromSeed(secretBase64Url, info);
  const iv = base64UrlDecode(encPayload.iv);
  const cipherBytes = base64UrlDecode(encPayload.ciphertext);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBytes);
  const text = new TextDecoder().decode(plainBuf);
  return JSON.parse(text);
}
