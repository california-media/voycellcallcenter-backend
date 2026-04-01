const { Schema, model } = require("mongoose");

const featureSchema = new Schema(
  {
    text: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const pricingTierSchema = new Schema(
  {
    price: { type: Number, required: true, default: 0 }, // in USD
    stripeProductId: { type: String, default: null },
    stripePriceId: { type: String, default: null },
    discountPercent: { type: Number, default: 0 }, // 0 for monthly
  },
  { _id: false }
);

const planSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    tag: { type: String, default: "" }, // e.g. "Most Popular"
    tagColor: { type: String, default: "#7c3aed" },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 }, // for drag-to-reorder

    features: {
      type: [featureSchema],
      default: [],
    },

    commonFeatures: {
      type: [featureSchema],
      default: [],
    },

    pricing: {
      monthly: { type: pricingTierSchema, default: () => ({ price: 0, discountPercent: 0 }) },
      quarterly: { type: pricingTierSchema, default: () => ({ price: 0, discountPercent: 0 }) },
      yearly: { type: pricingTierSchema, default: () => ({ price: 0, discountPercent: 0 }) },
    },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

planSchema.index({ isActive: 1, isDeleted: 1, order: 1 });

const Plan = model("Plan", planSchema);
module.exports = Plan;
