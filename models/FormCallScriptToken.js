// models/ScriptToken.js
const mongoose = require("mongoose");

const FormCallScriptTokenSchema = new mongoose.Schema({
  token: { type: String, unique: true, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  extensionNumber: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  // allowedOrigin: { type: String, default: "" }, // e.g. "https://example.com"
  allowedOrigin: {
    type: [String],
    default: [],
  }
});

module.exports = mongoose.model("FormCallScriptToken", FormCallScriptTokenSchema);
