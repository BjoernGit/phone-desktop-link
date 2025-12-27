const path = require("path");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

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

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 5 * 1024 * 1024, // 5 MB Payload-Limit fuer Photos
});

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

function isValidMime(mime) {
  return typeof mime === "string" && /^image\\//.test(mime) && mime.length < 64;
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

io.on("connection", (socket) => {
  console.log("socket connected", socket.id, "origin:", socket.handshake.headers.origin);
  const ip = socket.handshake.address;

  socket.on("join-session", ({ sessionId, role, deviceName, clientUuid }) => {
    const sid = coerceSessionId(sessionId);
    if (!isValidSessionId(sid) || !isValidRole(role) || (clientUuid && !isValidUuid(clientUuid))) {
      console.warn("join-session invalid payload", { sessionId, role, clientUuid });
      socket.disconnect(true);
      return;
    }
    if (!allowJoin(ip)) {
      console.warn("join-session rate-limited", { ip, sid });
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
      socket.disconnect(true);
      return;
    }
    if (!isValidBase64Url(iv, 8, 128) || !isValidBase64Url(ciphertext, 16, 8192)) return;
    if (mime && !isValidMime(mime)) return;
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
    if (offer.seed && !isValidBase64Url(offer.seed, 8, 256)) return;
    if (offer.session && !isValidSessionId(offer.session)) return;
    if (!inRoom(socket, sid)) return;
    if (!allowOffer(ip)) {
      console.warn("session-offer rate-limited", { ip, sid });
      socket.disconnect(true);
      return;
    }
    const dest = coerceSessionId(target) || sid;
    if (!dest && !targetUuid) return;
    console.log(`session-offer from ${sid} to ${dest || targetUuid}`);

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
