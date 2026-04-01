const { Schema, model } = require("mongoose");

const couponSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    expiresAt: { type: Date, default: null }, // null = never expires
    isActive: { type: Boolean, default: true },

    // Stripe references
    stripeCouponId: { type: String, default: null },
    stripePromotionCodeId: { type: String, default: null },

    // Soft delete
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

couponSchema.index({ code: 1, isDeleted: 1 });
couponSchema.index({ isActive: 1, expiresAt: 1 });

const Coupon = model("Coupon", couponSchema);
module.exports = Coupon;
