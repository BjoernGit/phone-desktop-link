const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  socket.on("join-session", ({ sessionId, role }) => {
    if (!sessionId) return;

    socket.join(sessionId);
    socket.data.sessionId = sessionId;
    socket.data.role = role;

    socket.to(sessionId).emit("peer-joined", { role });
  });

  socket.on("photo", ({ sessionId, imageDataUrl, meta }) => {
    if (!sessionId || !imageDataUrl) return;
    socket.to(sessionId).emit("photo", { imageDataUrl, meta: meta || null });
  });

  socket.on("disconnect", () => {
    const { sessionId, role } = socket.data || {};
    if (sessionId && role) {
      socket.to(sessionId).emit("peer-left", { role });
    }
  });
});

const distPath = path.join(__dirname, "..", "client", "dist");
app.use(express.static(distPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SERVER RUNNING ON PORT ${PORT}`);
});
