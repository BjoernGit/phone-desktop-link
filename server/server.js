const path = require("path");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
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

io.on("connection", (socket) => {
  console.log("socket connected", socket.id, "origin:", socket.handshake.headers.origin);

  socket.on("join-session", ({ sessionId, role, deviceName, clientUuid }) => {
    const sid = coerceSessionId(sessionId);
    if (!sid) return;
    console.log("join-session", { sessionId: sid, role, deviceName, clientUuid, socketId: socket.id });

    const room = roomName(sid);
    socket.join(room);
    socket.data.sessionId = sid;
    socket.data.role = role;
    socket.data.deviceName = deviceName;
    socket.data.clientUuid = clientUuid;

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
    const sid = coerceSessionId(sessionId);
    const activeSession = socket.data.sessionId;
    if (!sid || !activeSession || activeSession !== sid) return;
    const hasEncrypted = iv && ciphertext;
    if (!hasEncrypted) return;
    io.to(roomName(sid)).emit("photo", { iv, ciphertext, mime });
  });

  socket.on("session-offer", ({ sessionId, offer, target, targetUuid }) => {
    const sid = coerceSessionId(sessionId) || socket.data.sessionId;
    if (!offer || !sid) return;
    if (socket.data.sessionId !== sid) return; // nicht aus fremder Session senden
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
