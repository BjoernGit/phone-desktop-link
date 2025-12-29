const path = require("path");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
app.use(cors());

const server = http.createServer(app);

const ALLOWED_ORIGINS = [
  "https://snap2desk.com",
  "https://www.snap2desk.com",
  "https://snap2desk-dev.onrender.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

// Set HSTS when hinter HTTPS
app.use((req, res, next) => {
  const proto = req.headers["x-forwarded-proto"] || (req.connection && req.connection.encrypted ? "https" : "http");
  if (proto === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 10 * 1024 * 1024, // etwas grosszuegiger fuer groessere Bilder
});

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 Minuten fuer Offers
const BAN_DURATION_MS = 15 * 60 * 1000;
const BAN_THRESHOLD = 5;

function roomName(sessionId) {
  return `session:${sessionId}`;
}

function coerceSessionId(raw) {
  if (!raw) return "";
  return typeof raw === "string" ? raw : String(raw);
}

function isValidSessionId(id) {
  return typeof id === "string" && id.length >= 8 && id.length <= 32 && /^[a-zA-Z0-9_-]+$/.test(id);
}

function isValidRole(role) {
  return role === "mobile" || role === "desktop";
}

function isValidUuid(id) {
  return typeof id === "string" && id.length >= 6 && id.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(id);
}

const joinCounters = new Map();
const JOIN_LIMIT = 10; // joins per window
const JOIN_WINDOW_MS = 60 * 1000;

function allowJoin(ip) {
  if (!ip) return false;
  const now = Date.now();
  const entry = joinCounters.get(ip) || { count: 0, ts: now };
  const age = now - entry.ts;
  const withinWindow = age < JOIN_WINDOW_MS;
  const count = withinWindow ? entry.count + 1 : 1;
  joinCounters.set(ip, { count, ts: withinWindow ? entry.ts : now });
  return count <= JOIN_LIMIT;
}

function isValidBase64Url(str, minLen = 8, maxLen = 8192) {
  if (typeof str !== "string") return false;
  if (str.length < minLen || str.length > maxLen) return false;
  return /^[A-Za-z0-9_-]+$/.test(str);
}

const MAX_CIPHER_BASE64 = 8_000_000; // groessere Photos erlauben (ca. 6-7 MB Base64)

function isValidMime(mime) {
  return typeof mime === "string" && /^image\//.test(mime) && mime.length < 64;
}

function isValidEncPayload(enc) {
  if (!enc) return false;
  const { iv, ciphertext } = enc;
  return isValidBase64Url(iv, 8, 256) && isValidBase64Url(ciphertext, 16, 8192);
}

const sessionState = new Map();

function getSessionState(sessionId) {
  const existing = sessionState.get(sessionId);
  if (existing) return existing;
  const fresh = { approved: new Set(), rejected: new Set(), pending: new Set() };
  sessionState.set(sessionId, fresh);
  return fresh;
}

function inRoom(socket, sid) {
  const room = roomName(sid);
  return socket.rooms.has(room);
}

function createRateLimiter(limit, windowMs) {
  const map = new Map();
  return (key) => {
    if (!key) return false;
    const now = Date.now();
    const entry = map.get(key) || { count: 0, ts: now };
    const age = now - entry.ts;
    const withinWindow = age < windowMs;
    const count = withinWindow ? entry.count + 1 : 1;
    map.set(key, { count, ts: withinWindow ? entry.ts : now });
    return count <= limit;
  };
}

const allowPhoto = createRateLimiter(20, 60 * 1000); // 20 photos/minute per IP
const allowOffer = createRateLimiter(10, 60 * 1000); // 10 offers/minute per IP
const allowPhotoSession = createRateLimiter(120, 60 * 1000); // 120 photos/minute per Session
const allowOfferSession = createRateLimiter(60, 60 * 1000); // 60 offers/minute per Session

const offerNonces = new Map(); // sessionId -> Map(nonce -> ts)
const banned = new Map(); // ip -> { until, strikes }

function isBanned(ip) {
  if (!ip) return false;
  const entry = banned.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    banned.delete(ip);
    return false;
  }
  return true;
}

function registerStrike(ip, reason) {
  if (!ip) return false;
  const now = Date.now();
  const entry = banned.get(ip) || { strikes: 0, until: 0 };
  const strikes = entry.strikes + 1;
  if (strikes >= BAN_THRESHOLD) {
    banned.set(ip, { strikes, until: now + BAN_DURATION_MS });
    auditLog("ban", { ip, reason, strikes });
    return true;
  }
  banned.set(ip, { strikes, until: entry.until });
  auditLog("strike", { ip, reason, strikes });
  return false;
}

function cleanupNonces(sessionId) {
  const map = offerNonces.get(sessionId);
  if (!map) return;
  const now = Date.now();
  for (const [nonce, ts] of map.entries()) {
    if (now - ts > NONCE_TTL_MS) map.delete(nonce);
  }
}

function nonceSeen(sessionId, nonce, ts) {
  if (!sessionId || !nonce || typeof ts !== "number") return true;
  cleanupNonces(sessionId);
  const map = offerNonces.get(sessionId) || new Map();
  if (map.has(nonce)) return true;
  map.set(nonce, ts);
  offerNonces.set(sessionId, map);
  return false;
}

function hmacValid(seedBase64Url, payload, signature) {
  if (!seedBase64Url || !signature) return false;
  try {
    const base64 = seedBase64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const key = Buffer.from(padded, "base64");
    const mac = crypto.createHmac("sha256", key).update(payload).digest("base64url");
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(signature));
  } catch {
    return false;
  }
}

function auditLog(event, data) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n";
  fs.appendFile(path.join(__dirname, "security.log"), line, (err) => {
    if (err) console.warn("auditLog write failed", err);
  });
}

io.on("connection", (socket) => {
  console.log("socket connected", socket.id, "origin:", socket.handshake.headers.origin);
  const ip = socket.handshake.address;
  if (isBanned(ip)) {
    console.warn("socket banned", { ip });
    socket.disconnect(true);
    return;
  }

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

    if (!state.approved.size) {
      state.approved.add(clientUuid);
      state.pending.delete?.(clientUuid);
      state.rejected.delete?.(clientUuid);
      emitStatus(clientUuid, "approved");
    } else if (state.rejected.has(clientUuid)) {
      emitStatus(clientUuid, "rejected");
    } else if (state.approved.has(clientUuid)) {
      // Already approved - reconnect case, just re-emit approved status
      emitStatus(clientUuid, "approved");
    } else {
      state.pending.add(clientUuid);
      emitStatus(clientUuid, "pending");
    }

    // teile dem neuen Socket bestehende Stati mit
    state.approved.forEach((uuid) => {
      if (uuid !== clientUuid) socket.emit("peer-status", { clientUuid: uuid, status: "approved" });
    });
    state.rejected.forEach((uuid) => {
      if (uuid !== clientUuid) socket.emit("peer-status", { clientUuid: uuid, status: "rejected" });
    });
    state.pending.forEach((uuid) => {
      if (uuid !== clientUuid) socket.emit("peer-status", { clientUuid: uuid, status: "pending" });
    });

    // Bestehende Peers an den Joiner senden
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
    if (!isValidBase64Url(iv, 8, 128) || !isValidBase64Url(ciphertext, 16, MAX_CIPHER_BASE64)) {
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
    if (socket.data.sessionId !== sid) return; // nicht aus fremder Session senden
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
    if (Date.now() - offer.ts > NONCE_TTL_MS) {
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
    if (!state.approved.has(actorUuid)) return; // nur approvte duerfen entscheiden
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
      const room = roomName(sid);
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

  // WebRTC Signaling for P2P file transfer
  socket.on("webrtc-offer", ({ targetUuid, sdp }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;

    const sockets = Array.from(io.sockets.sockets.values()).filter(
      (s) => s.data.sessionId === sid && s.data.clientUuid === targetUuid
    );

    sockets.forEach((s) => {
      s.emit("webrtc-offer", {
        fromUuid: socket.data.clientUuid,
        sdp,
      });
    });
  });

  socket.on("webrtc-answer", ({ targetUuid, sdp }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;

    const sockets = Array.from(io.sockets.sockets.values()).filter(
      (s) => s.data.sessionId === sid && s.data.clientUuid === targetUuid
    );

    sockets.forEach((s) => {
      s.emit("webrtc-answer", {
        fromUuid: socket.data.clientUuid,
        sdp,
      });
    });
  });

  socket.on("webrtc-ice-candidate", ({ targetUuid, candidate }) => {
    const sid = socket.data.sessionId;
    if (!sid || !isValidUuid(targetUuid)) return;

    const sockets = Array.from(io.sockets.sockets.values()).filter(
      (s) => s.data.sessionId === sid && s.data.clientUuid === targetUuid
    );

    sockets.forEach((s) => {
      s.emit("webrtc-ice-candidate", {
        fromUuid: socket.data.clientUuid,
        candidate,
      });
    });
  });

  // File metadata broadcast
  socket.on("file-list-update", ({ files }) => {
    const sid = socket.data.sessionId;
    if (!sid) return;

    // Broadcast to all peers in session
    socket.to(roomName(sid)).emit("peer-file-list", {
      fromUuid: socket.data.clientUuid,
      files,
    });
  });

  socket.on("disconnect", () => {
    const sessionId = socket.data.sessionId;
    const role = socket.data.role;
    const deviceName = socket.data.deviceName;
    if (!sessionId || !role) return;

    socket.to(roomName(sessionId)).emit("peer-left", { role, clientId: socket.id, deviceName, clientUuid: socket.data.clientUuid });
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
