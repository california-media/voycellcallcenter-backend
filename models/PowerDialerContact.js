const { Schema, model } = require("mongoose");

const PowerDialerContactSchema = new Schema({
  list_id: { type: Schema.Types.ObjectId, ref: "PowerDialerList", required: true },
  company_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, default: "" },
  phone: { type: String, required: true },
  status: {
    type: String,
    enum: ["pending", "called", "no_answer", "busy", "failed"],
    default: "pending",
  },
  disposition: { type: String, default: "" },
  notes: { type: String, default: "" },
  attempt_count: { type: Number, default: 0 },
  last_called_at: { type: Date },
  order: { type: Number, default: 0 },
});

PowerDialerContactSchema.index({ list_id: 1, status: 1, order: 1 });

module.exports = model("PowerDialerContact", PowerDialerContactSchema);
