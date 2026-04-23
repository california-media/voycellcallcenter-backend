const { Schema, model, mongoose } = require("mongoose");

const invoiceSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      default: null,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      default: null,
    },

    // Stripe
    stripeInvoiceId: { type: String, unique: true, required: true },
    stripeCustomerId: { type: String, default: null },
    stripeChargeId: { type: String, default: null },

    // Invoice details
    invoiceNumber: { type: String, default: null },
    amount: { type: Number, required: true }, // in cents — Stripe amount_due (after balance/credits)
    amountPaid: { type: Number, default: 0 }, // in cents — actually charged to card
    // Sum of positive line items = the plan charge before proration credits.
    // Use this for display so proration upgrades show the real plan price, not $0.
    planAmount: { type: Number, default: null }, // in cents
    currency: { type: String, default: "usd" },
    status: {
      type: String,
      enum: ["draft", "open", "paid", "uncollectible", "void"],
      default: "open",
    },

    // URLs
    invoicePdf: { type: String, default: null },
    hostedInvoiceUrl: { type: String, default: null },

    // Billing period covered
    billingPeriodStart: { type: Date, default: null },
    billingPeriodEnd: { type: Date, default: null },

    // Coupon applied
    couponCode: { type: String, default: null },
    discountAmount: { type: Number, default: 0 }, // in cents

    // Created at from Stripe
    stripeCreatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

invoiceSchema.index({ userId: 1, createdAt: -1 });

const Invoice = model("Invoice", invoiceSchema);
module.exports = Invoice;
