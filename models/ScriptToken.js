// models/ScriptToken.js
const mongoose = require("mongoose");

const scriptTokenSchema = new mongoose.Schema({
  token: { type: String, unique: true, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  extensionNumber: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: "30d" } // auto delete after 30 days
});

module.exports = mongoose.model("ScriptToken", scriptTokenSchema);
