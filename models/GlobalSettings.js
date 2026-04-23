const { Schema, model } = require("mongoose");

/**
 * GlobalSettings — singleton document (key = "global").
 * Use GlobalSettings.findOneAndUpdate({ key: "global" }, ..., { upsert: true }) everywhere.
 */
const globalSettingsSchema = new Schema(
  {
    key: { type: String, default: "global", unique: true },

    // Discount % offered to subscribers who attempt to cancel
    retentionDiscountPercent: { type: Number, default: 30, min: 1, max: 100 },
  },
  { timestamps: true }
);

const GlobalSettings = model("GlobalSettings", globalSettingsSchema);
module.exports = GlobalSettings;
