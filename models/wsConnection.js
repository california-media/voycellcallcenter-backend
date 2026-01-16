const mongoose = require("mongoose");

const wsConnectionSchema = new mongoose.Schema({
  connectionId: {
    type: String,
    required: true,
    unique: true,
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

module.exports = mongoose.model("WsConnection", wsConnectionSchema);
