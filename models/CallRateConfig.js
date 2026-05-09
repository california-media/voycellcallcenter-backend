const { Schema, model } = require("mongoose");

// Single global document (key: "global") that holds the commission
// applied to ALL call rates.  customerRate = standardRate + commission.
const callRateConfigSchema = new Schema(
  {
    key:        { type: String, default: "global", unique: true },
    commission: { type: Number, default: 0, min: 0 }, // percentage (e.g. 20 = 20%) — customerRate = standardRate × (1 + commission/100)
  },
  { timestamps: true }
);

module.exports = model("CallRateConfig", callRateConfigSchema);
