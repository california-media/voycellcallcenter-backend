const { Schema, model } = require("mongoose");

const PowerDialerSessionSchema = new Schema({
  campaign_id: { type: Schema.Types.ObjectId, ref: "PowerDialerCampaign", required: true },
  agent_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
  company_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
  status: {
    type: String,
    enum: ["active", "paused", "stopped", "completed"],
    default: "active",
  },
  current_contact_id: { type: Schema.Types.ObjectId, ref: "PowerDialerContact" },
  skip_dispositions: [{ type: String }],
  started_at: { type: Date, default: Date.now },
  last_updated: { type: Date, default: Date.now },
  contacts_called: { type: Number, default: 0 },
});

PowerDialerSessionSchema.index({ agent_id: 1, status: 1 });
PowerDialerSessionSchema.index({ campaign_id: 1, status: 1 });

module.exports = model("PowerDialerSession", PowerDialerSessionSchema);
