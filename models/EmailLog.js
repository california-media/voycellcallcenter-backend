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
  },
  { timestamps: true }
);

emailLogSchema.index({ createdAt: -1 });

module.exports = model("EmailLog", emailLogSchema);
