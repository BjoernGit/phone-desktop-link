const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

app.use(express.static("public"));

io.on("connection", (socket) => {
  socket.on("join-session", ({ sessionId, role }) => {
    if (!sessionId || typeof sessionId !== "string") return;

    socket.join(sessionId);
    socket.data.sessionId = sessionId;
    socket.data.role = role || "unknown";

    io.to(sessionId).emit("peer-joined", {
      role: socket.data.role,
      socketId: socket.id,
    });
  });

  socket.on("photo", ({ sessionId, imageDataUrl }) => {
    if (!sessionId || typeof sessionId !== "string") return;
    if (!imageDataUrl || typeof imageDataUrl !== "string") return;

    socket.to(sessionId).emit("photo", { imageDataUrl });
  });

  socket.on("disconnect", () => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;

    io.to(sessionId).emit("peer-left", {
      role: socket.data.role || "unknown",
      socketId: socket.id,
    });
  });
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
