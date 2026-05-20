const { Schema, model } = require("mongoose");

const PowerDialerListSchema = new Schema({
  company_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  source: { type: String, enum: ["csv", "group"], default: "csv" },
  created_by: { type: Schema.Types.ObjectId, ref: "User" },
  total_contacts: { type: Number, default: 0 },
  assigned_to: [{ type: Schema.Types.ObjectId, ref: "User" }],
  created_at: { type: Date, default: Date.now },
});

module.exports = model("PowerDialerList", PowerDialerListSchema);
