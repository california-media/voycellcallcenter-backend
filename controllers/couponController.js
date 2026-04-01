const Coupon = require("../models/Coupon");
const stripeService = require("../services/stripeService");

// ─── Get All Coupons ──────────────────────────────────────────────────────────
const getAllCoupons = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      discountType,
      status, // "active" | "inactive" | "expired"
      search,
    } = req.query;

    const query = { isDeleted: false };

    if (discountType) query.discountType = discountType;

    if (status === "active") {
      query.isActive = true;
      query.$or = [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }];
    } else if (status === "inactive") {
      query.isActive = false;
    } else if (status === "expired") {
      query.expiresAt = { $lt: new Date() };
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { code: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [coupons, total] = await Promise.all([
      Coupon.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Coupon.countDocuments(query),
    ]);

    res.json({
      success: true,
      coupons,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error("getAllCoupons error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch coupons" });
  }
};

// ─── Create Coupon ────────────────────────────────────────────────────────────
const createCoupon = async (req, res) => {
  try {
    const { name, code, discountType, discountValue, expiresAt, isActive } = req.body;

    if (!name || !code || !discountType || discountValue === undefined) {
      return res.status(400).json({ success: false, message: "name, code, discountType, and discountValue are required" });
    }
    if (!["percentage", "fixed"].includes(discountType)) {
      return res.status(400).json({ success: false, message: "discountType must be 'percentage' or 'fixed'" });
    }
    if (discountType === "percentage" && (discountValue <= 0 || discountValue > 100)) {
      return res.status(400).json({ success: false, message: "Percentage discount must be between 1 and 100" });
    }
    if (discountType === "fixed" && discountValue <= 0) {
      return res.status(400).json({ success: false, message: "Fixed discount must be greater than 0" });
    }

    const existing = await Coupon.findOne({ code: code.toUpperCase(), isDeleted: false });
    if (existing) {
      return res.status(400).json({ success: false, message: "Coupon code already exists" });
    }

    // Create on Stripe
    const stripeCoupon = await stripeService.createStripeCoupon({
      discountType,
      discountValue,
      name,
      expiresAt: expiresAt || null,
    });

    const stripePromoCode = await stripeService.createStripePromotionCode(stripeCoupon.id, code);

    const coupon = await Coupon.create({
      name,
      code: code.toUpperCase(),
      discountType,
      discountValue,
      expiresAt: expiresAt || null,
      isActive: isActive !== undefined ? isActive : true,
      stripeCouponId: stripeCoupon.id,
      stripePromotionCodeId: stripePromoCode.id,
    });

    res.status(201).json({ success: true, message: "Coupon created successfully", coupon });
  } catch (err) {
    console.error("createCoupon error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to create coupon" });
  }
};

// ─── Update Coupon ────────────────────────────────────────────────────────────
const updateCoupon = async (req, res) => {
  try {
    const { couponId } = req.params;
    const { name, expiresAt, isActive } = req.body;

    const coupon = await Coupon.findOne({ _id: couponId, isDeleted: false });
    if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });

    // Only name, expiry, and active status can be updated (code/discount values cannot change in Stripe)
    if (name !== undefined) coupon.name = name;
    if (expiresAt !== undefined) coupon.expiresAt = expiresAt;
    if (isActive !== undefined) coupon.isActive = isActive;

    await coupon.save();

    res.json({ success: true, message: "Coupon updated successfully", coupon });
  } catch (err) {
    console.error("updateCoupon error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to update coupon" });
  }
};

// ─── Delete Coupon ────────────────────────────────────────────────────────────
const deleteCoupon = async (req, res) => {
  try {
    const { couponId } = req.params;
    const coupon = await Coupon.findOne({ _id: couponId, isDeleted: false });
    if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });

    // Deactivate on Stripe (if exists)
    if (coupon.stripePromotionCodeId) {
      await stripeService.deactivatePromotionCode(coupon.stripePromotionCodeId).catch(() => {});
    }
    if (coupon.stripeCouponId) {
      await stripeService.deleteStripeCoupon(coupon.stripeCouponId).catch(() => {});
    }

    coupon.isDeleted = true;
    coupon.deletedAt = new Date();
    coupon.isActive = false;
    await coupon.save();

    res.json({ success: true, message: "Coupon deleted successfully" });
  } catch (err) {
    console.error("deleteCoupon error:", err);
    res.status(500).json({ success: false, message: "Failed to delete coupon" });
  }
};

// ─── Toggle Coupon Status ─────────────────────────────────────────────────────
const toggleCouponStatus = async (req, res) => {
  try {
    const { couponId } = req.params;
    const coupon = await Coupon.findOne({ _id: couponId, isDeleted: false });
    if (!coupon) return res.status(404).json({ success: false, message: "Coupon not found" });

    coupon.isActive = !coupon.isActive;
    await coupon.save();

    res.json({
      success: true,
      message: `Coupon ${coupon.isActive ? "activated" : "deactivated"} successfully`,
      coupon,
    });
  } catch (err) {
    console.error("toggleCouponStatus error:", err);
    res.status(500).json({ success: false, message: "Failed to toggle coupon status" });
  }
};

module.exports = {
  getAllCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  toggleCouponStatus,
};
