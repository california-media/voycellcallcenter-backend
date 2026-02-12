const mongoose = require("mongoose");

const yeastarTokenSchema = new mongoose.Schema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    access_token: { type: String, required: true },
    refresh_token: { type: String },

    expires_in: { type: Number, default: 7200 },
    expires_at: { type: Date },

    base_url: { type: String, required: true },

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