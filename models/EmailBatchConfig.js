const { Schema, model } = require("mongoose");

// Global superadmin configuration for email batch sending.
// Only one document exists (key: "global").
const emailBatchConfigSchema = new Schema(
  {
    key:             { type: String, default: "global", unique: true },
    enabled:          { type: Boolean, default: false },
    batchSize:        { type: Number, default: 50, min: 1, max: 500 },
    intervalValue:    { type: Number, default: 1,  min: 1 },             // numeric part of the interval
    intervalUnit:     { type: String, default: "minutes", enum: ["seconds", "minutes", "hours", "days"] },
    // Derived helper — interval in seconds (kept in sync by controller on every save)
    intervalSeconds:  { type: Number, default: 60 },
    dailyCap:         { type: Number, default: 5000, min: 1 },
  },
  { timestamps: true }
);

module.exports = model("EmailBatchConfig", emailBatchConfigSchema);
