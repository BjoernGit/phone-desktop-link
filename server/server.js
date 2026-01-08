const path = require("path");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

// Config
const config = require("./config/limits");
const { FEATURE_FLAGS } = require("./config/features");

// Session management
const {
  getSessionState,
  roomName,
  coerceSessionId,
  inRoom,
} = require("./session/sessionManager");

// Rate limiting & security
const {
  allowJoin,
  allowPhoto,
  allowOffer,
  allowPhotoSession,
  allowOfferSession,
  isBanned,
  registerStrike,
  nonceSeen,
  auditLog,
} = require("./middleware/rateLimiter");

// Validation
const {
  isValidSessionId,
  isValidRole,
  isValidUuid,
  isValidBase64Url,
  isValidMime,
  isValidEncPayload,
} = require("./utils/validation");

// Handlers
const { registerWebRTCHandlers } = require("./handlers/webrtcSignaling");
const { registerFileTransferHandlers } = require("./handlers/fileTransferHandler");

const app = express();
app.use(cors());

const server = http.createServer(app);

// Set HSTS when behind HTTPS
app.use((req, res, next) => {
  const proto = req.headers["x-forwarded-proto"] || (req.connection && req.connection.encrypted ? "https" : "http");
  if (proto === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

const io = new Server(server, {
  cors: {
    origin: config.ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: config.MAX_HTTP_BUFFER_SIZE,
});

io.on("connection", (socket) => {
  console.log("socket connected", socket.id, "origin:", socket.handshake.headers.origin);
  const ip = socket.handshake.address;

  if (isBanned(ip)) {
    console.warn("socket banned", { ip });
    socket.disconnect(true);
    return;
  }

  // Session handlers
  socket.on("join-session", ({ sessionId, role, deviceName, clientUuid }) => {
    const sid = coerceSessionId(sessionId);
    if (!isValidSessionId(sid) || !isValidRole(role) || (clientUuid && !isValidUuid(clientUuid))) {
      console.warn("join-session invalid payload", { sessionId, role, clientUuid });
      socket.disconnect(true);
      return;
    }
    if (!allowJoin(ip)) {
      console.warn("join-session rate-limited", { ip, sid });
      registerStrike(ip, "join-rate");
      socket.disconnect(true);
      return;
    }
    console.log("join-session", { sessionId: sid, role, deviceName, clientUuid, socketId: socket.id, ip });

    const room = roomName(sid);
    socket.join(room);
    socket.data.sessionId = sid;
    socket.data.role = role;
    socket.data.deviceName = deviceName;
    socket.data.clientUuid = clientUuid;

    const state = getSessionState(sid);
    const emitStatus = (uuid, status) => io.to(room).emit("peer-status", { clientUuid: uuid, status });

    // First peer OR device approval disabled = auto-approve
    const shouldAutoApprove = !state.approved.size || !FEATURE_FLAGS.REQUIRE_DEVICE_APPROVAL;

    if (shouldAutoApprove) {
      state.approved.add(clientUuid);
      state.pending.delete?.(clientUuid);
      state.rejected.delete?.(clientUuid);
      emitStatus(clientUuid, "approved");
    } else if (state.rejected.has(clientUuid)) {
      emitStatus(clientUuid, "rejected");
    } else if (state.approved.has(clientUuid)) {
      emitStatus(clientUuid, "approved");
    } else {
      // Only reach here if REQUIRE_DEVICE_APPROVAL is true and not first peer
      state.pending.add(clientUuid);
      emitStatus(clientUuid, "pending");
    }

    // Send existing states to new socket
    state.approved.forEach((uuid) => {
      if (uuid !== clientUuid) socket.emit("peer-status", { clientUuid: uuid, status: "approved" });
    });
    state.rejected.forEach((uuid) => {
      if (uuid !== clientUuid) socket.emit("peer-status", { clientUuid: uuid, status: "rejected" });
    });
    state.pending.forEach((uuid) => {
      if (uuid !== clientUuid) socket.emit("peer-status", { clientUuid: uuid, status: "pending" });
    });

    // Send existing peers to joiner
    const roomInfo = io.sockets.adapter.rooms.get(room);
    if (roomInfo && roomInfo.size > 1) {
      roomInfo.forEach((id) => {
        if (id === socket.id) return;
        const other = io.sockets.sockets.get(id);
        if (!other?.data?.role) return;
        socket.emit("peer-joined", {
          role: other.data.role,
          clientId: id,
          deviceName: other.data.deviceName,
          clientUuid: other.data.clientUuid,
        });
      });
    }

    socket.to(room).emit("peer-joined", { role, clientId: socket.id, deviceName, clientUuid });
  });

  socket.on("photo", ({ sessionId, iv, ciphertext, mime }) => {
    const sid = coerceSessionId(sessionId) || socket.data.sessionId;
    const activeSession = socket.data.sessionId;
    if (!sid || !activeSession || activeSession !== sid) return;
    if (!inRoom(socket, sid)) return;
    if (!allowPhoto(ip)) {
      console.warn("photo rate-limited", { ip, sid });
      registerStrike(ip, "photo-rate");
      socket.disconnect(true);
      return;
    }
    if (!isValidBase64Url(iv, 8, 128) || !isValidBase64Url(ciphertext, 16, config.MAX_CIPHER_BASE64)) {
      console.warn("[invalid] photo payload rejected", { ip, sid, ivLen: iv?.length, ctLen: ciphertext?.length });
      registerStrike(ip, "photo-invalid");
      return;
    }
    if (mime && !isValidMime(mime)) return;
    if (!allowPhotoSession(sid)) {
      console.warn("photo rate-limited (session)", { sid });
      socket.disconnect(true);
      return;
    }
    const state = getSessionState(sid);
    const senderUuid = socket.data.clientUuid;
    if (!state.approved.has(senderUuid)) return;
    if (state.rejected.has(senderUuid)) return;
    io.to(roomName(sid)).emit("photo", { iv, ciphertext, mime, senderUuid });
  });

  socket.on("session-offer", ({ sessionId, offer, target, targetUuid }) => {
    const sid = coerceSessionId(sessionId) || socket.data.sessionId;
    if (!offer || !sid) return;
    if (socket.data.sessionId !== sid) return;
    if (typeof offer !== "object") return;
    if (!isValidEncPayload(offer.enc)) {
      console.warn("[invalid] session-offer enc payload", { ip, sid });
      registerStrike(ip, "offer-enc");
      return;
    }
    if (!offer.nonce || typeof offer.ts !== "number") {
      console.warn("[invalid] session-offer missing nonce/ts", { ip, sid });
      registerStrike(ip, "offer-missing-nonce");
      return;
    }
    if (Date.now() - offer.ts > config.NONCE_TTL_MS) {
      console.warn("[invalid] session-offer expired", { ip, sid });
      registerStrike(ip, "offer-expired");
      return;
    }
    if (nonceSeen(sid, offer.nonce, offer.ts)) {
      console.warn("[invalid] session-offer nonce-reused", { ip, sid });
      registerStrike(ip, "offer-reuse");
      return;
    }
    if (!inRoom(socket, sid)) return;
    if (!allowOffer(ip)) {
      console.warn("session-offer rate-limited", { ip, sid });
      registerStrike(ip, "offer-rate");
      socket.disconnect(true);
      return;
    }
    if (!allowOfferSession(sid)) {
      console.warn("session-offer rate-limited (session)", { sid });
      socket.disconnect(true);
      return;
    }
    const dest = coerceSessionId(target) || sid;
    if (!dest && !targetUuid) return;
    console.log(`session-offer from ${sid} to ${dest || targetUuid}`);
    auditLog("offer", { fromSession: sid, to: dest || targetUuid, ip, nonce: offer.nonce, ts: offer.ts });

    const payload = {
      ...offer,
      fromRole: socket.data.role,
      fromDevice: socket.data.deviceName,
      fromUuid: socket.data.clientUuid,
    };

    if (targetUuid) {
      const sockets = Array.from(io.sockets.sockets.values()).filter((s) => s.data.clientUuid === targetUuid);
      sockets.forEach((s) => s.emit("session-offer", payload));
    } else if (dest) {
      socket.to(roomName(dest)).emit("session-offer", payload);
    }
  });

  socket.on("peer-decision", ({ targetUuid, decision }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;
    if (!isValidSessionId(sid)) return;
    const state = getSessionState(sid);
    const actorUuid = socket.data.clientUuid;
    if (!state.approved.has(actorUuid)) return;
    const room = roomName(sid);
    const emitStatus = (uuid, status) => io.to(room).emit("peer-status", { clientUuid: uuid, status });

    if (decision === "approve") {
      state.pending.delete(targetUuid);
      state.rejected.delete(targetUuid);
      state.approved.add(targetUuid);
      emitStatus(targetUuid, "approved");
    } else if (decision === "reject" || decision === "reject-offer") {
      state.pending.delete(targetUuid);
      state.approved.delete(targetUuid);
      state.rejected.add(targetUuid);
      emitStatus(targetUuid, "rejected");
      const rejectedSockets = Array.from(io.sockets.sockets.values()).filter(
        (s) => s.data.sessionId === sid && s.data.clientUuid === targetUuid
      );
      rejectedSockets.forEach((s) => {
        s.leave(room);
        s.disconnect(true);
      });
    }
  });

  socket.on("leave-session", ({ sessionId, clientUuid }) => {
    const sid = coerceSessionId(sessionId);
    if (!sid || !clientUuid) return;
    if (socket.data.sessionId !== sid || socket.data.clientUuid !== clientUuid) return;

    console.log("leave-session", { sessionId: sid, clientUuid, socketId: socket.id });
    const room = roomName(sid);
    socket.to(room).emit("peer-left", {
      role: socket.data.role,
      clientId: socket.id,
      deviceName: socket.data.deviceName,
      clientUuid: socket.data.clientUuid,
    });
    socket.leave(room);
  });

  // Register modular handlers
  registerWebRTCHandlers(socket, io);
  registerFileTransferHandlers(socket, io, ip);

  socket.on("disconnect", () => {
    const sessionId = socket.data.sessionId;
    const role = socket.data.role;
    const deviceName = socket.data.deviceName;
    if (!sessionId || !role) return;

    socket.to(roomName(sessionId)).emit("peer-left", {
      role,
      clientId: socket.id,
      deviceName,
      clientUuid: socket.data.clientUuid,
    });
  });
});

const clientDistPath = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDistPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on ${PORT}`);
});
