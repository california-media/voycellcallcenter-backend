const mongoose = require("mongoose");
const Plan = require("./models/Plan");
require("dotenv").config();

// ── Edit base price here before running ──────────────────────────────────────
const BASE_PRICE = 29; // USD per month
// ─────────────────────────────────────────────────────────────────────────────

const plans = [
  {
    name: "Monthly",
    description: "Flexible month-to-month billing. Cancel anytime.",
    tag: "",
    tagColor: "#7c3aed",
    isActive: true,
    order: 1,
    isEnterprise: false,
    agentPrice: 0,
    pricing: {
      monthly:    { price: BASE_PRICE,  discountPercent: 0  },
      quarterly:  { price: 0, discountPercent: 0 },
      semiannual: { price: 0, discountPercent: 0 },
      yearly:     { price: 0, discountPercent: 0 },
    },
    features: [],
    commonFeatures: [],
  },
  {
    name: "Quarterly",
    description: "Save 10% by paying every 3 months.",
    tag: "",
    tagColor: "#7c3aed",
    isActive: true,
    order: 2,
    isEnterprise: false,
    agentPrice: 0,
    pricing: {
      monthly:    { price: 0, discountPercent: 0 },
      quarterly:  { price: BASE_PRICE, discountPercent: 10 },
      semiannual: { price: 0, discountPercent: 0 },
      yearly:     { price: 0, discountPercent: 0 },
    },
    features: [],
    commonFeatures: [],
  },
  {
    name: "Half Yearly",
    description: "Save 15% by paying every 6 months.",
    tag: "Popular",
    tagColor: "#7c3aed",
    isActive: true,
    order: 3,
    isEnterprise: false,
    agentPrice: 0,
    pricing: {
      monthly:    { price: 0, discountPercent: 0 },
      quarterly:  { price: 0, discountPercent: 0 },
      semiannual: { price: BASE_PRICE, discountPercent: 15 },
      yearly:     { price: 0, discountPercent: 0 },
    },
    features: [],
    commonFeatures: [],
  },
  {
    name: "Annual",
    description: "Best value — save 20% with yearly billing.",
    tag: "Best Value",
    tagColor: "#059669",
    isActive: true,
    order: 4,
    isEnterprise: false,
    agentPrice: 0,
    pricing: {
      monthly:    { price: 0, discountPercent: 0 },
      quarterly:  { price: 0, discountPercent: 0 },
      semiannual: { price: 0, discountPercent: 0 },
      yearly:     { price: BASE_PRICE, discountPercent: 20 },
    },
    features: [],
    commonFeatures: [],
  },
];

(async () => {
  await mongoose.connect(process.env.MONGO_URL);
  console.log("Connected to MongoDB");

  for (const planData of plans) {
    const existing = await Plan.findOne({ name: planData.name, isDeleted: false });
    if (existing) {
      // Update pricing (price + discountPercent) for each period without touching features or Stripe IDs
      for (const period of Object.keys(planData.pricing)) {
        if (existing.pricing[period]) {
          existing.pricing[period].price = planData.pricing[period].price;
          existing.pricing[period].discountPercent = planData.pricing[period].discountPercent;
        }
      }
      existing.markModified("pricing");
      await existing.save();
      console.log(`Updated pricing for plan: ${existing.name}`);
      continue;
    }
    const plan = await Plan.create(planData);
    console.log(`Created plan: ${plan.name} (${plan._id})`);
  }

  console.log("Done.");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
