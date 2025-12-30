/**
 * File Transfer Handler
 * Handles Socket.io fallback file transfers and file list broadcasting
 */

const config = require("../config/limits");
const { isValidUuid } = require("../utils/validation");
const { getSessionState, roomName, findSocketsByUuid } = require("../session/sessionManager");
const {
  allowTransferBytes,
  registerStrike,
  getActiveTransfers,
  trackTransfer,
  untrackTransfer,
} = require("../middleware/rateLimiter");

/**
 * Register file transfer handlers on a socket
 * @param {Socket} socket
 * @param {Server} io
 * @param {string} ip - Client IP address
 */
function registerFileTransferHandlers(socket, io, ip) {
  // File metadata broadcast
  socket.on("file-list-update", ({ files }) => {
    const sid = socket.data.sessionId;
    if (!sid) return;

    const room = roomName(sid);
    const senderUuid = socket.data.clientUuid;

    // Check if sender is approved
    const state = getSessionState(sid);
    if (!state.approved.has(senderUuid)) {
      console.warn("[file-list-update] sender not approved", { senderUuid, sid });
      return;
    }
    if (state.rejected.has(senderUuid)) {
      console.warn("[file-list-update] sender rejected", { senderUuid, sid });
      return;
    }

    console.log(`[File Broadcast Server] From ${senderUuid} in room ${room}, broadcasting ${files?.length || 0} files`);

    io.to(room).emit("peer-file-list", {
      fromUuid: senderUuid,
      files,
    });
  });

  // Socket.io fallback for file transfer request
  socket.on("file-request-socketio", ({ targetUuid, fileId }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;

    console.log(`[File Request Socket.io] From ${socket.data.clientUuid} to ${targetUuid}, file: ${fileId}`);

    const sockets = findSocketsByUuid(io, sid, targetUuid);
    sockets.forEach((s) => {
      s.emit("file-request-socketio", {
        fromUuid: socket.data.clientUuid,
        fileId,
      });
    });
  });

  // File transfer start (metadata)
  socket.on("file-transfer-socketio-start", ({ targetUuid, fileId, fileName, fileSize, fileType, totalChunks }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;

    // Enforce server-side file size limit
    if (typeof fileSize !== "number" || fileSize > config.SOCKETIO_MAX_FILE_SIZE) {
      const sizeMB = fileSize ? (fileSize / (1024 * 1024)).toFixed(1) : "unknown";
      const limitMB = (config.SOCKETIO_MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
      console.warn(`[File Transfer Socket.io] REJECTED: File too large (${sizeMB}MB > ${limitMB}MB limit) from ${socket.data.clientUuid}`);
      socket.emit("file-transfer-socketio-error", {
        fileId,
        error: "file_too_large",
        message: `File size (${sizeMB}MB) exceeds server limit of ${limitMB}MB for Socket.io transfers. Please use WebRTC for larger files.`,
        maxSize: config.SOCKETIO_MAX_FILE_SIZE,
      });
      return;
    }

    // Check rate limit (100MB/minute per IP)
    if (!allowTransferBytes(ip, fileSize)) {
      const limitMB = (config.SOCKETIO_TRANSFER_LIMIT_BYTES / (1024 * 1024)).toFixed(0);
      console.warn(`[File Transfer Socket.io] RATE LIMITED: ${ip} exceeded ${limitMB}MB/minute transfer limit`);
      socket.emit("file-transfer-socketio-error", {
        fileId,
        error: "rate_limited",
        message: `Transfer rate limit exceeded (${limitMB}MB per minute). Please wait before transferring more files.`,
      });
      registerStrike(ip, "transfer-rate");
      return;
    }

    // Check concurrent transfer limit
    const activeSet = getActiveTransfers(ip);
    if (activeSet.size >= config.MAX_CONCURRENT_TRANSFERS) {
      console.warn(`[File Transfer Socket.io] REJECTED: Too many concurrent transfers from ${ip}`);
      socket.emit("file-transfer-socketio-error", {
        fileId,
        error: "too_many_transfers",
        message: `Maximum ${config.MAX_CONCURRENT_TRANSFERS} concurrent transfers allowed. Please wait for current transfers to complete.`,
      });
      return;
    }

    // Track this transfer as active
    trackTransfer(ip, fileId);

    console.log(`[File Transfer Socket.io Start] From ${socket.data.clientUuid} to ${targetUuid}, file: ${fileName} (${fileSize} bytes)`);

    const sockets = findSocketsByUuid(io, sid, targetUuid);
    sockets.forEach((s) => {
      s.emit("file-transfer-socketio-start", {
        fromUuid: socket.data.clientUuid,
        fileId,
        fileName,
        fileSize,
        fileType,
        totalChunks,
      });
    });
  });

  // File transfer chunk (binary data)
  socket.on("file-transfer-socketio", ({ targetUuid, fileId, chunk, chunkIndex }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;

    const sockets = findSocketsByUuid(io, sid, targetUuid);
    sockets.forEach((s) => {
      s.emit("file-transfer-socketio", {
        fromUuid: socket.data.clientUuid,
        fileId,
        chunk,
        chunkIndex,
      });
    });
  });

  // File transfer complete
  socket.on("file-transfer-socketio-complete", ({ targetUuid, fileId }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;

    // Remove from active transfers
    untrackTransfer(ip, fileId);

    console.log(`[File Transfer Socket.io Complete] From ${socket.data.clientUuid} to ${targetUuid}, file: ${fileId}`);

    const sockets = findSocketsByUuid(io, sid, targetUuid);
    sockets.forEach((s) => {
      s.emit("file-transfer-socketio-complete", {
        fromUuid: socket.data.clientUuid,
        fileId,
      });
    });
  });
}

module.exports = { registerFileTransferHandlers };
