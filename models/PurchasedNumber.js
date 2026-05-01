const { Schema, model } = require("mongoose");

const purchasedNumberSchema = new Schema(
  {
    companyAdminId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    didPurchaseId: { type: String, required: true },
    number: { type: String, required: true },
    countryCode: { type: String, default: "" },
    numberType: { type: String, default: "local" },
    didlogicCostPerMonth: { type: Number, default: 0 },
    ourPricePerMonth: { type: Number, default: 0 },
    marginPercent: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "released"], default: "active" },
    expiresAt: { type: Date },
    didlogicData: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = model("PurchasedNumber", purchasedNumberSchema);
