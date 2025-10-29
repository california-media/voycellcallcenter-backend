// // models/YeastarToken.js
// const mongoose = require("mongoose");

// const yeastarTokenSchema = new mongoose.Schema({
//   access_token: { type: String, required: true },
//   refresh_token: { type: String, required: true },
//   expires_in: { type: Number, required: true }, // seconds
//   expires_at: { type: Date, default: Date.now },
//   created_at: { type: Date, default: Date.now },
// });

// yeastarTokenSchema.virtual("isExpired").get(function () {
//   const expiryTime = new Date(this.created_at).getTime() + this.expires_in * 1000;
//   return Date.now() > expiryTime;
// });

// module.exports = mongoose.model("YeastarToken", yeastarTokenSchema);

const mongoose = require("mongoose");

const yeastarTokenSchema = new mongoose.Schema(
  {
    access_token: { type: String, required: true },
    refresh_token: { type: String, required: true },
    expires_in: { type: Number, required: true, default: 7200 }, // lifespan in seconds
    expires_at: { type: Date, required: true }, // exact expiry timestamp
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Virtual field to check if token expired
yeastarTokenSchema.virtual("isExpired").get(function () {
  if (!this.expires_in || !this.created_at) return true;
  const expiryTime = new Date(this.created_at).getTime() + this.expires_in * 1000;
  return Date.now() > expiryTime;
});

// Optional index to auto-remove old tokens (if you want MongoDB cleanup)
yeastarTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("YeastarToken", yeastarTokenSchema);