const { Schema, model } = require("mongoose");

const userActivitySchema = new Schema(
  {
    userId:    { type: Schema.Types.ObjectId, ref: "User", default: null },
    userEmail: { type: String, default: null },
    userName:  { type: String, default: null },
    userRole:  { type: String, default: null },
    ip:        { type: String, default: null },

    // Browser session (resets on tab/window close)
    sessionId: { type: String, default: null },

    // Page info
    page:       { type: String, required: true },
    pageTitle:  { type: String, default: null },

    // Where they came from
    referrer:     { type: String, default: null },  // full URL or path
    referrerType: { type: String, enum: ["direct", "internal", "external"], default: "direct" },
    referrerHost: { type: String, default: null },  // e.g. "google.com"

    // Time
    enteredAt:        { type: Date, default: Date.now },
    timeSpentSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

userActivitySchema.index({ userId: 1 });
userActivitySchema.index({ enteredAt: -1 });
userActivitySchema.index({ sessionId: 1 });
userActivitySchema.index({ page: 1 });

const UserActivity = model("UserActivity", userActivitySchema);
module.exports = UserActivity;
