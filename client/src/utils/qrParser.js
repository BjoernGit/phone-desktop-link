/**
 * Parse QR code URL and extract session parameters
 * @param {string} raw - Raw QR code data (URL)
 * @returns {Object} Parsed QR data with session, seed, targetUuid, offerSecret, timestamp, and raw
 */
export function parseQrUrl(raw) {
  try {
    const url = new URL(raw);
    const session = url.searchParams.get("session") || "";
    const targetUuid = url.searchParams.get("uid") || "";
    const hashParams = url.hash ? new URLSearchParams(url.hash.replace(/^#/, "")) : new URLSearchParams();
    const seed = hashParams.get("seed") || "";
    const offerSecret = hashParams.get("ok") || "";
    const timestamp = hashParams.get("t") || "";
    return { session, seed, targetUuid, offerSecret, timestamp, raw };
  } catch {
    return { session: "", seed: "", targetUuid: "", offerSecret: "", timestamp: "", raw };
  }
}
