const { Schema, model } = require("mongoose");

const notificationLogSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    body: { type: String, default: "" },
    target: { type: String, enum: ["all", "companies", "specific"], default: "all" },
    targetCompanyIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    targetCompanyNames: [{ type: String }],
    recipientCount: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true }
);

module.exports = model("NotificationLog", notificationLogSchema);
