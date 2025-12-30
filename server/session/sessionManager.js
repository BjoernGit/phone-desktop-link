/**
 * Session State Manager
 * Manages session approval states (approved, rejected, pending peers)
 */

const sessionState = new Map();

/**
 * Get or create session state
 * @param {string} sessionId
 * @returns {{ approved: Set, rejected: Set, pending: Set }}
 */
function getSessionState(sessionId) {
  const existing = sessionState.get(sessionId);
  if (existing) return existing;
  const fresh = { approved: new Set(), rejected: new Set(), pending: new Set() };
  sessionState.set(sessionId, fresh);
  return fresh;
}

/**
 * Generate room name from session ID
 * @param {string} sessionId
 * @returns {string}
 */
function roomName(sessionId) {
  return `session:${sessionId}`;
}

/**
 * Coerce raw session ID to string
 * @param {any} raw
 * @returns {string}
 */
function coerceSessionId(raw) {
  if (!raw) return "";
  return typeof raw === "string" ? raw : String(raw);
}

/**
 * Check if socket is in session room
 * @param {Socket} socket
 * @param {string} sessionId
 * @returns {boolean}
 */
function inRoom(socket, sessionId) {
  const room = roomName(sessionId);
  return socket.rooms.has(room);
}

/**
 * Find all sockets for a specific client UUID in a session
 * @param {Server} io - Socket.io server instance
 * @param {string} sessionId
 * @param {string} clientUuid
 * @returns {Socket[]}
 */
function findSocketsByUuid(io, sessionId, clientUuid) {
  return Array.from(io.sockets.sockets.values()).filter(
    (s) => s.data.sessionId === sessionId && s.data.clientUuid === clientUuid
  );
}

module.exports = {
  getSessionState,
  roomName,
  coerceSessionId,
  inRoom,
  findSocketsByUuid,
};
