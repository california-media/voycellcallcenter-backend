const { Schema, model } = require("mongoose");

/**
 * EmailLog — records every broadcast email send initiated from the super admin.
 * Mirrors NotificationLog in structure but is specific to email broadcasts.
 */
const emailLogSchema = new Schema(
  {
    subject:            { type: String, required: true },
    title:              { type: String, default: "" },
    body:               { type: String, default: "" },          // full HTML body
    target:             { type: String, enum: ["all", "companies", "specific", "excel", "batch"], default: "all" },
    targetCompanyIds:   [{ type: Schema.Types.ObjectId, ref: "User" }],
    targetCompanyNames: [{ type: String }],
    recipientCount:     { type: Number, default: 0 },
    // Snapshot of recipients so we can show the stats modal later
    recipients: [
      {
        email:     { type: String },
        name:      { type: String, default: "" },
        userId:    { type: Schema.Types.ObjectId, ref: "User" },
      },
    ],
    // Which sender address was used
    fromEmail:  { type: String, default: "noreply@voycell.com" },
    fromName:   { type: String, default: "VOYCELL" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // ── SES tracking counters (incremented by the SNS webhook as events arrive) ──
    stats: {
      sends:       { type: Number, default: 0 },
      deliveries:  { type: Number, default: 0 },
      opens:       { type: Number, default: 0 },
      clicks:      { type: Number, default: 0 },
      bounces:     { type: Number, default: 0 },
      complaints:  { type: Number, default: 0 },
      rejections:  { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

emailLogSchema.index({ createdAt: -1 });

module.exports = model("EmailLog", emailLogSchema);
