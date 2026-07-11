/**
 * WebRTC Helper Functions
 * Extracted common patterns from useWebRTC to reduce duplication
 */

// Set to true for verbose WebRTC debugging (must match useWebRTC.js)
const DEBUG_WEBRTC = false;

/**
 * Setup DataChannel message listener with buffering support
 * Handles race condition where messages arrive before callback is registered
 *
 * @param {RTCDataChannel} dc - The DataChannel to setup
 * @param {string} peerUuid - The peer's UUID
 * @param {React.MutableRefObject<Map>} messageCallbacksRef - Ref to callback map
 * @param {React.MutableRefObject<Map>} messageBufferRef - Ref to message buffer map
 */
export function setupDataChannelMessageListener(
  dc,
  peerUuid,
  messageCallbacksRef,
  messageBufferRef
) {
  dc.addEventListener("message", (msgEvent) => {
    const callback = messageCallbacksRef.current.get(peerUuid);
    if (callback) {
      callback(msgEvent);
    } else {
      if (DEBUG_WEBRTC) console.log(
        `[WebRTC] Buffering message for ${peerUuid} (no callback registered yet)`
      );
      const buffer = messageBufferRef.current.get(peerUuid) || [];
      buffer.push(msgEvent);
      messageBufferRef.current.set(peerUuid, buffer);
    }
  });
}

/**
 * Setup DataChannel event handlers (onopen, onclose, onerror, onstatechange)
 *
 * @param {RTCDataChannel} dc - The DataChannel to setup
 * @param {string} peerUuid - The peer's UUID
 * @param {Object} options - Configuration options
 * @param {React.MutableRefObject<Map>} options.dataChannelsRef - Ref to data channels map
 * @param {Function} options.setDataChannels - State setter for data channels
 * @param {React.MutableRefObject<Map>} options.messageBufferRef - Ref to message buffer map
 * @param {React.MutableRefObject<Map>} options.messageCallbacksRef - Ref to callbacks map
 * @param {Function} [options.onOpenCallback] - Optional callback when channel opens
 */
export function setupDataChannelEventHandlers(dc, peerUuid, options) {
  const {
    dataChannelsRef,
    setDataChannels,
    messageBufferRef,
    messageCallbacksRef,
    onOpenCallback,
  } = options;

  dc.onopen = () => {
    if (DEBUG_WEBRTC) console.log(`[WebRTC] DataChannel opened for ${peerUuid}`);
    // With glare (both sides initiating) two channels can open for the same
    // peer. Keep the first healthy one - a duplicate must not displace it,
    // otherwise the registered per-peer state points at the wrong channel.
    const existing = dataChannelsRef.current.get(peerUuid);
    if (existing && existing !== dc && existing.readyState === "open") {
      if (DEBUG_WEBRTC) console.log(`[WebRTC] Duplicate DataChannel for ${peerUuid}, keeping existing`);
      return;
    }
    dataChannelsRef.current.set(peerUuid, dc);
    setDataChannels(new Map(dataChannelsRef.current));
    if (onOpenCallback) {
      onOpenCallback(dc);
    }
  };

  dc.onclose = () => {
    if (DEBUG_WEBRTC) console.log(`[WebRTC] DataChannel closed for ${peerUuid}`);
    // Only clear per-peer state if this channel is still the active one.
    // With glare (both sides initiating) a superseded channel can close
    // long after its replacement opened - it must not clobber the new
    // channel's registration, or messages silently pile up in the buffer.
    if (dataChannelsRef.current.get(peerUuid) !== dc) return;
    dataChannelsRef.current.delete(peerUuid);
    setDataChannels(new Map(dataChannelsRef.current));
    messageBufferRef.current.delete(peerUuid);
    messageCallbacksRef.current.delete(peerUuid);
  };

  dc.onerror = (error) => {
    console.error(`[WebRTC] DataChannel error for ${peerUuid}:`, error);
  };

  dc.onstatechange = () => {
    if (DEBUG_WEBRTC) console.log(
      `[WebRTC] DataChannel state changed for ${peerUuid}: ${dc.readyState}`
    );
  };
}

/**
 * Process buffered ICE candidates after remote description is set
 *
 * @param {RTCPeerConnection} pc - The peer connection
 * @param {string} peerUuid - The peer's UUID
 * @param {React.MutableRefObject<Map>} iceCandidateBufferRef - Ref to ICE buffer map
 * @param {AbortSignal} [abortSignal] - Optional abort signal for cancellation
 */
export async function processBufferedIceCandidates(
  pc,
  peerUuid,
  iceCandidateBufferRef,
  abortSignal
) {
  const bufferedCandidates = iceCandidateBufferRef.current.get(peerUuid) || [];
  if (DEBUG_WEBRTC) console.log(
    `[WebRTC] Processing ${bufferedCandidates.length} buffered ICE candidates for ${peerUuid}`
  );

  for (const candidate of bufferedCandidates) {
    if (abortSignal?.aborted) {
      if (DEBUG_WEBRTC) console.log(`[WebRTC] ICE processing aborted for ${peerUuid}`);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error(`[WebRTC] Error adding buffered ICE candidate:`, error);
    }
  }

  // Clear buffer
  iceCandidateBufferRef.current.set(peerUuid, []);
}

/**
 * WebRTC Configuration Constants
 */
export const WEBRTC_CONFIG = {
  MAX_ICE_CANDIDATES: 100,
  // Google STUN servers for internet connectivity (free, reliable)
  // Only used for NAT traversal - actual data flows peer-to-peer
  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  DEFAULT_OFFER_TIMEOUT_MS: 15000,
  DRAIN_TIMEOUT_MS: 5000,
  DRAIN_CHECK_INTERVAL_MS: 50,
  ICE_SERVERS_LOAD_TIMEOUT_MS: 4000,
};

// TURN/STUN servers issued by the backend (Cloudflare relay). Loaded once
// per page; empty when the server has no TURN key configured, in which
// case connections stay STUN-only as before.
let relayIceServers = [];
let relayIceServersPromise = null;

/**
 * Request TURN credentials from the backend over the socket connection.
 * Safe to call multiple times - only the first call fetches. Resolves once
 * the answer arrives or after a timeout; failures leave STUN-only config.
 *
 * @param {Socket} socket - Connected socket.io instance
 * @returns {Promise<void>}
 */
export function loadRelayIceServers(socket) {
  if (relayIceServersPromise || !socket) {
    return relayIceServersPromise || Promise.resolve();
  }

  relayIceServersPromise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (DEBUG_WEBRTC) console.log("[WebRTC] TURN credentials request timed out, staying STUN-only");
      resolve();
    }, WEBRTC_CONFIG.ICE_SERVERS_LOAD_TIMEOUT_MS);

    try {
      // socket.io buffers the emit until connected, so calling early is fine
      socket.emit("request-turn-credentials", (response) => {
        clearTimeout(timer);
        if (response && Array.isArray(response.iceServers)) {
          relayIceServers = response.iceServers;
          if (DEBUG_WEBRTC) console.log("[WebRTC] Loaded relay ICE servers", relayIceServers);
        }
        resolve();
      });
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });

  return relayIceServersPromise;
}

/**
 * Await the relay ICE server load kicked off by loadRelayIceServers.
 * Resolves immediately if it was never started.
 */
export function relayIceServersReady() {
  return relayIceServersPromise || Promise.resolve();
}

/**
 * Create RTCPeerConnection configuration object
 */
export function createPeerConnectionConfig() {
  return {
    iceServers: [...WEBRTC_CONFIG.ICE_SERVERS, ...relayIceServers],
    iceCandidatePoolSize: 10,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
}
