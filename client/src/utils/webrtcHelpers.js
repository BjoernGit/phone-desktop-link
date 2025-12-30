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
    dataChannelsRef.current.set(peerUuid, dc);
    setDataChannels(new Map(dataChannelsRef.current));
    if (onOpenCallback) {
      onOpenCallback(dc);
    }
  };

  dc.onclose = () => {
    if (DEBUG_WEBRTC) console.log(`[WebRTC] DataChannel closed for ${peerUuid}`);
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
  // Empty for local network - host candidates are sufficient
  // Add STUN/TURN servers for internet connectivity
  ICE_SERVERS: [],
  DEFAULT_OFFER_TIMEOUT_MS: 15000,
  DRAIN_TIMEOUT_MS: 5000,
  DRAIN_CHECK_INTERVAL_MS: 50,
};

/**
 * Create RTCPeerConnection configuration object
 */
export function createPeerConnectionConfig() {
  return {
    iceServers: WEBRTC_CONFIG.ICE_SERVERS,
    iceCandidatePoolSize: 10,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
}
