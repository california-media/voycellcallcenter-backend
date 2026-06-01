const { Schema, model } = require("mongoose");

// Tracks a scheduled email broadcast split into batches.
const emailBatchJobSchema = new Schema(
  {
    // Unique ID used as part of the EventBridge schedule names
    jobId:            { type: String, required: true, unique: true },
    status:           { type: String, enum: ["pending", "in_progress", "completed", "failed", "cancelled"], default: "pending" },

    // Email content
    subject:          { type: String, required: true },
    title:            { type: String, default: "" },
    body:             { type: String, required: true },
    fromEmail:        { type: String, default: null },
    fromName:         { type: String, default: "VOYCELL" },
    replyTo:          { type: String, default: null },
    copyTo:           { type: String, default: null },   // silent copy address
    // Attachments stored as base64 so Lambda can access them at send time
    attachments: [
      {
        filename:    { type: String },
        contentType: { type: String },
        content:     { type: String },   // base64 encoded file content
      },
    ],

    // Config snapshot at time of scheduling
    batchSize:        { type: Number, required: true },
    intervalValue:    { type: Number, required: true },
    intervalUnit:     { type: String, required: true },
    intervalSeconds:  { type: Number, required: true },   // pre-computed for scheduling
    totalRecipients:   { type: Number, default: 0 },
    droppedCount:      { type: Number, default: 0 },   // recipients trimmed by hourly/daily cap
    totalBatches:      { type: Number, default: 0 },
    // The user-provided startAt (raw, before the 2-min minimum-buffer is applied).
    // null means the user chose "send immediately".  Used by the UI to correctly
    // display "Immediately" vs an actual scheduled time without ambiguity.
    scheduledStartAt:  { type: Date,   default: null },
    completedBatches: { type: Number, default: 0 },
    failedBatches:    { type: Number, default: 0 },

    // Dynamic field names defined by the superadmin (e.g. ["name", "company"])
    // Used to personalise each email — placeholders like {{name}} are replaced
    // with the matching value from each recipient's `data` object at send time.
    dynamicFields: { type: [String], default: [] },

    // Individual batches
    batches: [
      {
        index:       { type: Number, required: true },
        recipients:  [
          {
            email: String,
            name:  { type: String, default: "" },
            // Arbitrary key-value map of dynamic field values for this recipient
            // e.g. { name: "John Smith", company: "Acme Ltd", phone: "0501234567" }
            data:  { type: Schema.Types.Mixed, default: {} },
          },
        ],
        // "partial" = some emails in the batch sent, some failed
        status:                 { type: String, enum: ["pending", "sent", "failed", "partial"], default: "pending" },
        scheduledAt:            { type: Date, default: null },
        sentAt:                 { type: Date, default: null },
        error:                  { type: String, default: null },
        // Per-batch send result counts — visible in UI so partial failures are never hidden
        succeededCount:         { type: Number, default: 0 },
        failedCount:            { type: Number, default: 0 },
        // True only when EventBridge confirmed the schedule was created successfully.
        // If this is false and status is still "pending", the batch has no schedule
        // in EventBridge and will never fire on its own — use the manual trigger endpoint.
        scheduledInEventBridge: { type: Boolean, default: false },
      },
    ],

    // Running stats incremented live by the SES webhook as events arrive
    stats: {
      sends:       { type: Number, default: 0 },
      deliveries:  { type: Number, default: 0 },
      opens:       { type: Number, default: 0 },
      clicks:      { type: Number, default: 0 },
      bounces:     { type: Number, default: 0 },
      complaints:  { type: Number, default: 0 },
      rejections:  { type: Number, default: 0 },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

emailBatchJobSchema.index({ status: 1, createdAt: -1 });
emailBatchJobSchema.index({ createdBy: 1 });
// Needed by the daily cap query in emailBatchService which filters by status + updatedAt
emailBatchJobSchema.index({ status: 1, updatedAt: -1 });

module.exports = model("EmailBatchJob", emailBatchJobSchema);
