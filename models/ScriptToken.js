// models/ScriptToken.js
const mongoose = require("mongoose");

const scriptTokenSchema = new mongoose.Schema({
  token: { type: String, unique: true, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  extensionNumber: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  // allowedOrigin: { type: String, default: "" }, // e.g. "https://example.com"
  allowedOriginPopup: {
    type: [String],
    default: [],
  },
  allowedOriginContactForm: {
    type: [String],
    default: [],
  },
  fieldName: { type: String, default: "phone" },
  restrictedUrls: {
    type: [String],
    default: [],
  }
});

module.exports = mongoose.model("ScriptToken", scriptTokenSchema);
