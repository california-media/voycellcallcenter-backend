const { Schema, model } = require("mongoose");

const emailEntrySchema = new Schema(
  {
    order:     { type: Number, required: true },
    delayDays: { type: Number, required: true, min: 0 },
    subject:   { type: String, required: true },
    body:      { type: String, required: true },
  },
  { _id: false }
);

const activationEmailConfigSchema = new Schema(
  {
    key:                          { type: String, default: "global", unique: true },
    isActive:                     { type: Boolean, default: true },
    suspensionDaysAfterLastEmail: { type: Number, default: 3, min: 1 },
    emails:                       { type: [emailEntrySchema], default: [] },
  },
  { timestamps: true }
);

module.exports = model("ActivationEmailConfig", activationEmailConfigSchema);
