const { Schema, model } = require("mongoose");

const didLogicSettingsSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },
    apiToken: { type: String, default: "" },
    isTestMode: { type: Boolean, default: true },
    numberMarginPercent:     { type: Number, default: 0, min: 0, max: 1000 },
    activationMarginPercent: { type: Number, default: 0, min: 0, max: 1000 },
    callMarginPercent:       { type: Number, default: 0, min: 0, max: 1000 },
  },
  { timestamps: true }
);

module.exports = model("DIDLogicSettings", didLogicSettingsSchema);
