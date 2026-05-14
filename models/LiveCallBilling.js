const mongoose = require("mongoose");

const liveCallBillingSchema = new mongoose.Schema(
  {
    userId:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    companyAdminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    destination:    { type: String, required: true }, // normalized digits only
    didNumber:      { type: String, default: null },
    ratePerMin:     { type: Number, default: null },
    billedMinutes:  { type: Number, default: 0 },
    totalCharged:   { type: Number, default: 0 },
    // Yeastar SDK callId from the browser — may differ from CDR id, used as best-effort match
    sdkCallId:      { type: String, default: null },
    endedAt:        { type: Date, default: null },
  },
  { timestamps: true }
);

liveCallBillingSchema.index({ sdkCallId: 1, companyAdminId: 1 });
liveCallBillingSchema.index({ companyAdminId: 1, destination: 1, createdAt: -1 });

module.exports = mongoose.model("LiveCallBilling", liveCallBillingSchema);
