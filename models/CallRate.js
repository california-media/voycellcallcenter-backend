const { Schema, model } = require("mongoose");

const callRateSchema = new Schema(
  {
    country:      { type: String, required: true, trim: true },
    prefix:       { type: String, required: true, trim: true },
    standardRate: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

callRateSchema.index({ country: 1 });
callRateSchema.index({ prefix: 1 });

module.exports = model("CallRate", callRateSchema);
