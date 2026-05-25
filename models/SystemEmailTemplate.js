const mongoose = require("mongoose");

const SystemEmailTemplateSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["balance_warning", "account_locked"],
      required: true,
      unique: true,
    },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    reminderFrequencyDays: { type: Number, default: 7 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SystemEmailTemplate", SystemEmailTemplateSchema);
