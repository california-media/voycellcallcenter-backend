const { Schema, model, mongoose } = require("mongoose");

const subscriptionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      required: true,
    },
    billingPeriod: {
      type: String,
      enum: ["monthly", "quarterly", "yearly"],
      required: true,
    },
    status: {
      type: String,
      enum: ["trialing", "active", "paused", "cancelled", "expired", "incomplete"],
      default: "trialing",
    },

    // Stripe identifiers
    stripeSubscriptionId: { type: String, default: null },
    stripeCustomerId: { type: String, default: null },

    // Billing period
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },

    // Trial period
    trialStart: { type: Date, default: null },
    trialEnd: { type: Date, default: null },

    // Pause / Resume logic
    pausedAt: { type: Date, default: null },
    pauseDurationDays: { type: Number, default: 0 }, // how long they may pause
    resumedAt: { type: Date, default: null },
    remainingDaysAtPause: { type: Number, default: 0 }, // days left in billing period when paused

    // Cancellation
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },

    // Coupon
    couponCode: { type: String, default: null },
    stripeCouponId: { type: String, default: null },

    // Metadata
    autoRenewal: { type: Boolean, default: true },
    lastInvoiceId: { type: String, default: null },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, status: 1 });
subscriptionSchema.index({ stripeSubscriptionId: 1 });

const Subscription = model("Subscription", subscriptionSchema);
module.exports = Subscription;
