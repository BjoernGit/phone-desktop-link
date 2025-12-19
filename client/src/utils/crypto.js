function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function base64UrlEncode(bytes) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(str) {
  const padLength = (4 - (str.length % 4)) % 4;
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLength);
  return fromBase64(padded);
}

export async function generateAesKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function importAesKey(base64Url) {
  const raw = base64UrlDecode(base64Url);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function exportAesKey(key) {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return base64UrlEncode(raw);
}

function dataUrlToBytes(dataUrl) {
  const parts = dataUrl.split(",");
  if (parts.length < 2) throw new Error("Invalid data URL");
  const mimeMatch = parts[0].match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const bytes = fromBase64(parts[1]);
  return { mime, bytes };
}

function bytesToDataUrl(bytes, mime = "image/jpeg") {
  return `data:${mime};base64,${toBase64(bytes)}`;
}

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
