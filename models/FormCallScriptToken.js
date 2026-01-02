// models/ScriptToken.js
const mongoose = require("mongoose");

const FormCallScriptTokenSchema = new mongoose.Schema({
  token: { type: String, unique: true, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  extensionNumber: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  /* The `fieldName` field in the `FormCallScriptTokenSchema` schema is defining a property that stores
  a string value. In this case, the default value for `fieldName` is set to "phone". This field
  likely represents the name of a field in a form or a specific identifier related to the token. */
  fieldName: { type: String, default: "phone" },
  // allowedOrigin: { type: String, default: "" }, // e.g. "https://example.com"
  allowedOriginPopup: {
    type: [String],
    default: [],
  },
  allowedOriginContactForm: {
    type: [String],
    default: [],
  },
  restrictedUrls: {
    type: [String],
    default: [],
  }
});

module.exports = mongoose.model("FormCallScriptToken", FormCallScriptTokenSchema);
