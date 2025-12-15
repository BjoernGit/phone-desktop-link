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
  socket.on("join-session", ({ sessionId, role }) => {
    if (!sessionId) return;

    const room = roomName(sessionId);
    socket.join(room);
    socket.data.sessionId = sessionId;
    socket.data.role = role;

    socket.to(room).emit("peer-joined", { role });
  });

  socket.on("photo", ({ sessionId, imageDataUrl }) => {
    if (!sessionId || !imageDataUrl) return;
    io.to(roomName(sessionId)).emit("photo", { imageDataUrl });
  });

  socket.on("disconnect", () => {
    const sessionId = socket.data.sessionId;
    const role = socket.data.role;
    if (!sessionId || !role) return;

    socket.to(roomName(sessionId)).emit("peer-left", { role });
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
