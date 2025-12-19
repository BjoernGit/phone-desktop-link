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
});

function roomName(sessionId) {
  return `session:${sessionId}`;
}

io.on("connection", (socket) => {
  socket.on("join-session", ({ sessionId, role, deviceName }) => {
    if (!sessionId) return;

    const room = roomName(sessionId);
    socket.join(room);
    socket.data.sessionId = sessionId;
    socket.data.role = role;
    socket.data.deviceName = deviceName;

    socket.to(room).emit("peer-joined", { role, clientId: socket.id, deviceName });
  });

  socket.on("photo", ({ sessionId, imageDataUrl, iv, ciphertext, mime }) => {
    if (!sessionId) return;
    const hasEncrypted = iv && ciphertext;
    const hasPlain = !!imageDataUrl;
    if (!hasEncrypted && !hasPlain) return;
    io.to(roomName(sessionId)).emit("photo", { imageDataUrl, iv, ciphertext, mime });
  });

  socket.on("disconnect", () => {
    const sessionId = socket.data.sessionId;
    const role = socket.data.role;
    const deviceName = socket.data.deviceName;
    if (!sessionId || !role) return;

    socket.to(roomName(sessionId)).emit("peer-left", { role, clientId: socket.id, deviceName });
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
