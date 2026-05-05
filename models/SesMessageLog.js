const { Schema, model } = require("mongoose");

/**
 * SesMessageLog — maps a SES messageId (returned by SMTP at send time)
 * back to the EmailLog campaign and the specific recipient.
 *
 * Created immediately after each sendAdminBroadcastEmail() call.
 * emailLogId may be null initially for batch sends (EmailLog is created
 * only after the last batch completes) and is back-filled then.
 */
const sesMessageLogSchema = new Schema(
  {
    sesMessageId:   { type: String, required: true, unique: true },
    emailLogId:     { type: Schema.Types.ObjectId, ref: "EmailLog", default: null, index: true },
    batchJobId:     { type: String, default: null, index: true },   // links to EmailBatchJob.jobId
    recipientEmail: { type: String, required: true },
    sentAt:         { type: Date, default: Date.now },
  },
  { timestamps: false }
);


module.exports = model("SesMessageLog", sesMessageLogSchema);
