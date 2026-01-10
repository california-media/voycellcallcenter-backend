const { Server } = require("socket.io");

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
    },
  });

  io.on("connection", (socket) => {
    console.log("🟢 Client connected:", socket.id);

    socket.on("join", (userId) => {
      socket.join(userId);
      console.log(`User ${userId} joined room`);
    });

    socket.on("disconnect", () => {
      console.log("🔴 Client disconnected:", socket.id);
    });
  });
}

function emitMessage(userId, message) {
  if (!io) return;
  io.to(userId.toString()).emit("whatsapp_message", message);
  console.log("Message emitted to user:", userId);
  console.log("Message content:", message);
}

module.exports = { initSocket, emitMessage };