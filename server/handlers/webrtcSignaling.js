/**
 * WebRTC Signaling Handler
 * Handles WebRTC offer/answer/ICE candidate exchange for P2P connections
 */

const { isValidUuid } = require("../utils/validation");
const { findSocketsByUuid } = require("../session/sessionManager");

/**
 * Register WebRTC signaling handlers on a socket
 * @param {Socket} socket
 * @param {Server} io
 */
function registerWebRTCHandlers(socket, io) {
  // WebRTC offer
  socket.on("webrtc-offer", ({ targetUuid, sdp }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;

    const sockets = findSocketsByUuid(io, sid, targetUuid);
    sockets.forEach((s) => {
      s.emit("webrtc-offer", {
        fromUuid: socket.data.clientUuid,
        sdp,
      });
    });
  });

  // WebRTC answer
  socket.on("webrtc-answer", ({ targetUuid, sdp }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;

    const sockets = findSocketsByUuid(io, sid, targetUuid);
    sockets.forEach((s) => {
      s.emit("webrtc-answer", {
        fromUuid: socket.data.clientUuid,
        sdp,
      });
    });
  });

  // WebRTC ICE candidate
  socket.on("webrtc-ice-candidate", ({ targetUuid, candidate }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;

    const sockets = findSocketsByUuid(io, sid, targetUuid);
    sockets.forEach((s) => {
      s.emit("webrtc-ice-candidate", {
        fromUuid: socket.data.clientUuid,
        candidate,
      });
    });
  });
}

module.exports = { registerWebRTCHandlers };
