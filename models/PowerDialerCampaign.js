const { Schema, model } = require("mongoose");

const PowerDialerCampaignSchema = new Schema({
  company_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
  list_id: { type: Schema.Types.ObjectId, ref: "PowerDialerList", required: true },
  name: { type: String, required: true },
  description: { type: String, default: "" },
  allocation: { type: String, enum: ["users", "teams"], default: "users" },
  assignees: [{ type: Schema.Types.ObjectId, ref: "User" }],
  from_number: { type: String, default: "" },
  from_number_type: { type: String, enum: ["number", "group"], default: "number" },
  call_dispositions: [{ type: String }],
  timezone_dialing: { type: Boolean, default: false },
  auto_machine_detection: { type: Boolean, default: false },
  auto_voicemail_drop: { type: Boolean, default: false },
  attempt_per_contact: { type: Number, default: 1 },
  status: {
    type: String,
    enum: ["draft", "active", "paused", "completed", "stopped"],
    default: "draft",
  },
  calls_completed: { type: Number, default: 0 },
  created_by: { type: Schema.Types.ObjectId, ref: "User" },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
});

module.exports = model("PowerDialerCampaign", PowerDialerCampaignSchema);
