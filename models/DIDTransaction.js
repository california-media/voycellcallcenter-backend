const { Schema, model } = require("mongoose");

const didTransactionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: {
      type: String,
      enum: ["number_purchase", "monthly_renewal", "number_release_refund"],
      required: true,
    },
    amount: { type: Number, required: true }, // in USD (positive = debit, negative = credit)
    description: { type: String, default: "" },
    number: { type: String, default: "" },
    countryName: { type: String, default: "" },
    didAssignmentId: { type: Schema.Types.ObjectId, ref: "DIDAssignment", default: null },
    status: { type: String, enum: ["completed", "failed", "refunded"], default: "completed" },
  },
  { timestamps: true }
);

module.exports = model("DIDTransaction", didTransactionSchema);
