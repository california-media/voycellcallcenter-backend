const { Schema, model } = require("mongoose");

/**
 * SesEmailEvent — one document per SES tracking event received via SNS.
 * Covers: Send, Delivery, Bounce, Complaint, Open, Click, Reject, RenderingFailure.
 */
const sesEmailEventSchema = new Schema(
  {
    sesMessageId:   { type: String, required: true, index: true },
    emailLogId:     { type: Schema.Types.ObjectId, ref: "EmailLog", default: null, index: true },
    batchJobId:     { type: String, default: null },        // set for batch sends
    eventType:      { type: String, required: true },       // Delivery | Bounce | Complaint | Open | Click | Send | Reject
    recipientEmail: { type: String, default: "" },
    timestamp:      { type: Date, default: Date.now },

    // Bounce details
    bounceType:        { type: String, default: null },     // Permanent | Transient | Undetermined
    bounceSubType:     { type: String, default: null },     // General | NoEmail | Suppressed | etc.

    // Click details
    clickUrl:          { type: String, default: null },

    // Open / Click user-agent & IP
    userAgent:         { type: String, default: null },
    ipAddress:         { type: String, default: null },

    // Full raw event stored for debugging / future processing
    raw:               { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

sesEmailEventSchema.index({ emailLogId: 1, eventType: 1 });
sesEmailEventSchema.index({ sesMessageId: 1, eventType: 1 });

module.exports = model("SesEmailEvent", sesEmailEventSchema);
