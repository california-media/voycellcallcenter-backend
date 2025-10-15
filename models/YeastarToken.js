// models/YeastarToken.js
const mongoose = require("mongoose");

const yeastarTokenSchema = new mongoose.Schema({
  access_token: { type: String, required: true },
  refresh_token: { type: String, required: true },
  expires_in: { type: Number, required: true }, // seconds
  created_at: { type: Date, default: Date.now },
});

yeastarTokenSchema.virtual("isExpired").get(function () {
  const expiryTime = new Date(this.created_at).getTime() + this.expires_in * 1000;
  return Date.now() > expiryTime;
});

module.exports = mongoose.model("YeastarToken", yeastarTokenSchema);
