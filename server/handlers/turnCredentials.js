/**
 * TURN Credentials Handler
 * Issues short-lived Cloudflare TURN credentials over the existing socket
 * connection so WebRTC can fall back to a relay when no direct path exists
 * (mesh WiFi blocking mDNS, client isolation, strict NATs).
 *
 * Requires a Cloudflare Realtime TURN key via env vars:
 *   TURN_KEY_ID        - the Turn Token ID
 *   TURN_KEY_API_TOKEN - the API token (server-side secret, never sent to clients)
 * Optional kill switch: TURN_DISABLED=true stops issuing credentials, which
 * reverts clients to STUN-only (today's Socket.io fallback behavior).
 */

// Credentials are shared across clients within the cache window - they are
// short-lived HMAC tokens, not per-user secrets. Caching keeps us from
// hitting the Cloudflare API on every page load.
const CREDENTIAL_TTL_SECONDS = 6 * 60 * 60; // outlives any realistic session
const CACHE_TTL_MS = 5 * 60 * 1000;
const CLOUDFLARE_TIMEOUT_MS = 5000;
const MAX_REQUESTS_PER_SOCKET = 5;

let cache = { iceServers: null, fetchedAt: 0 };
let pendingFetch = null;

function turnEnabled() {
  return Boolean(
    process.env.TURN_KEY_ID &&
    process.env.TURN_KEY_API_TOKEN &&
    process.env.TURN_DISABLED !== "true"
  );
}

async function fetchIceServersFromCloudflare() {
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${process.env.TURN_KEY_ID}/credentials/generate-ice-servers`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUDFLARE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TURN_KEY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Cloudflare TURN API responded ${response.status}`);
    }

    const data = await response.json();
    // API returns { iceServers: [...] }; tolerate a single object too
    const iceServers = Array.isArray(data.iceServers)
      ? data.iceServers
      : data.iceServers
        ? [data.iceServers]
        : null;

    if (!iceServers || iceServers.length === 0) {
      throw new Error("Cloudflare TURN API returned no iceServers");
    }
    return iceServers;
  } finally {
    clearTimeout(timer);
  }
}

async function getIceServers() {
  if (cache.iceServers && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.iceServers;
  }
  // Coalesce concurrent requests into one Cloudflare call
  if (!pendingFetch) {
    pendingFetch = fetchIceServersFromCloudflare()
      .then((iceServers) => {
        cache = { iceServers, fetchedAt: Date.now() };
        return iceServers;
      })
      .finally(() => {
        pendingFetch = null;
      });
  }
  return pendingFetch;
}

/**
 * Register the TURN credentials handler on a socket
 * @param {Socket} socket
 */
function registerTurnHandlers(socket) {
  socket.on("request-turn-credentials", async (ack) => {
    if (typeof ack !== "function") return;

    socket.data.turnRequests = (socket.data.turnRequests || 0) + 1;
    if (socket.data.turnRequests > MAX_REQUESTS_PER_SOCKET) {
      console.warn("request-turn-credentials rate-limited", { socketId: socket.id });
      return ack({ iceServers: null });
    }

    if (!turnEnabled()) {
      return ack({ iceServers: null });
    }

    try {
      const iceServers = await getIceServers();
      ack({ iceServers });
    } catch (error) {
      console.error("request-turn-credentials failed:", error.message);
      ack({ iceServers: null });
    }
  });
}

module.exports = { registerTurnHandlers };
