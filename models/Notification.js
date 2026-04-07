const { Schema, model } = require("mongoose");

const notificationSchema = new Schema(
  {
    // Who this notification belongs to (companyAdmin or agent user)
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // The company this notification belongs to (set to companyAdmin's _id for agents too)
    companyId: { type: Schema.Types.ObjectId, ref: "User", index: true },

    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    // Rich body: can contain HTML / markdown with embedded image URLs, doc links, etc.
    body: { type: String, default: "" },

    // Optional attachments: [{ name, url, type }]
    attachments: [
      {
        name: { type: String },
        url: { type: String },
        type: { type: String, enum: ["image", "document", "link", "other"], default: "other" },
      },
    ],

    isRead: { type: Boolean, default: false, index: true },

    // Optional category / tag for grouping (e.g. "billing", "system", "announcement")
    category: { type: String, default: "general" },

    // Who created this notification (superAdmin _id or "system")
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },

    // Link back to the NotificationLog entry (set for superAdmin broadcasts)
    logId: { type: Schema.Types.ObjectId, ref: "NotificationLog", index: true },
  },
  { timestamps: true }
);

// Compound index for efficient paginated queries per user
notificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = model("Notification", notificationSchema);
