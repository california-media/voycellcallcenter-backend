const { Schema, model } = require("mongoose");

const userSessionSchema = new Schema(
  {
    userId:     { type: Schema.Types.ObjectId, ref: "User", required: true },
    userEmail:  { type: String, default: null },
    userName:   { type: String, default: null },
    userRole:   { type: String, default: null },

    // Network
    ip:         { type: String, default: null },

    // Device / Browser (parsed from User-Agent)
    userAgent:    { type: String, default: null },
    browser:      { type: String, default: null }, // "Chrome 124"
    browserName:  { type: String, default: null },
    browserVersion: { type: String, default: null },
    os:           { type: String, default: null }, // "Windows 11"
    osName:       { type: String, default: null },
    osVersion:    { type: String, default: null },
    deviceType:   { type: String, enum: ["desktop", "mobile", "tablet", "unknown"], default: "unknown" },
    deviceVendor: { type: String, default: null },
    deviceModel:  { type: String, default: null },

    // Screen / Viewport (sent by frontend)
    screenWidth:    { type: Number, default: null },
    screenHeight:   { type: Number, default: null },
    viewportWidth:  { type: Number, default: null },
    viewportHeight: { type: Number, default: null },
    pixelRatio:     { type: Number, default: null },

    // Locale
    timezone: { type: String, default: null },
    language: { type: String, default: null },

    loginAt:  { type: Date, default: Date.now },
  },
  { timestamps: true }
);

userSessionSchema.index({ userId: 1 });
userSessionSchema.index({ loginAt: -1 });

const UserSession = model("UserSession", userSessionSchema);
module.exports = UserSession;
