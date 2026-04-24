const mongoose = require("mongoose");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const Invoice = require("../models/Invoice");
const Coupon = require("../models/Coupon");
const User = require("../models/userModel");
const GlobalSettings = require("../models/GlobalSettings");
const stripeService = require("../services/stripeService");

// Sum of positive line items on a Stripe invoice (the actual plan charge before proration credits).
// Proration invoices have e.g. +$29 (new plan) and -$28.70 (credit), so amount_due = $0.30
// and amount_paid = $0 (balance covered). planAmount = $29 so billing UI shows the real cost.
const calcPlanAmount = (stripeInvoice) => {
  const lines = stripeInvoice?.lines?.data || [];
  const positive = lines.filter((li) => (li.amount || 0) > 0).reduce((s, li) => s + li.amount, 0);
  return positive || stripeInvoice?.amount_due || 0;
};

// ─── Get Active Plans (for company admin to browse) ───────────────────────────
const getActivePlans = async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true, isDeleted: false }).sort({ order: 1 });
    res.json({ success: true, plans });
  } catch (err) {
    console.error("getActivePlans error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch plans" });
  }
};

// ─── Get Current Subscription ─────────────────────────────────────────────────
const getCurrentSubscription = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("planStatus trialStartedAt trialEndsAt trialDurationDays stripeCustomerId");

    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["trialing", "active", "paused"] },
    }).populate("planId");

    // Derive effective planStatus from the live subscription rather than relying on
    // the User.planStatus field, which may be stale (e.g. "cancelled" written before
    // we stopped doing that, or out-of-sync after an admin action).
    // Rule:
    //   • Active subscription (even with cancelAtPeriodEnd) → "active"
    //   • No subscription but user is on trial (and trial still valid) → "trial"
    //   • Everything else → whatever is stored in User.planStatus
    let effectivePlanStatus = user.planStatus;
    if (subscription && ["active", "trialing", "paused"].includes(subscription.status)) {
      effectivePlanStatus = "active";
    }

    res.json({
      success: true,
      subscription: subscription || null,
      planStatus: effectivePlanStatus,
      trialEndsAt: user.trialEndsAt,
      trialStartedAt: user.trialStartedAt,
      trialDurationDays: user.trialDurationDays,
    });
  } catch (err) {
    console.error("getCurrentSubscription error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch subscription" });
  }
};

// ─── Validate Coupon ──────────────────────────────────────────────────────────
const validateCoupon = async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: "Coupon code is required" });

    const coupon = await Coupon.findOne({
      code: code.toUpperCase(),
      isActive: true,
      isDeleted: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    });

    if (!coupon) {
      return res.status(404).json({ success: false, message: "Invalid or expired coupon code" });
    }

    res.json({
      success: true,
      coupon: {
        _id: coupon._id,
        name: coupon.name,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        stripePromotionCodeId: coupon.stripePromotionCodeId,
      },
    });
  } catch (err) {
    console.error("validateCoupon error:", err);
    res.status(500).json({ success: false, message: "Failed to validate coupon" });
  }
};

// ─── Create Setup Intent (for adding a card) ──────────────────────────────────
const createSetupIntent = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const customer = await stripeService.getOrCreateCustomer(user);

    // Save Stripe customer ID if new
    if (!user.stripeCustomerId) {
      await User.findByIdAndUpdate(user._id, { stripeCustomerId: customer.id });
    }

    const setupIntent = await stripeService.createSetupIntent(customer.id);
    res.json({ success: true, clientSecret: setupIntent.client_secret });
  } catch (err) {
    console.error("createSetupIntent error:", err);
    res.status(500).json({ success: false, message: "Failed to create setup intent" });
  }
};

// ─── List Payment Methods ─────────────────────────────────────────────────────
const listPaymentMethods = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("stripeCustomerId");
    if (!user.stripeCustomerId) {
      return res.json({ success: true, paymentMethods: [], defaultPaymentMethodId: null });
    }

    const paymentMethods = await stripeService.listPaymentMethods(user.stripeCustomerId);
    const customer = await stripeService.retrieveCustomer(user.stripeCustomerId);
    const defaultPmId = customer.invoice_settings?.default_payment_method?.id ||
      customer.invoice_settings?.default_payment_method || null;

    res.json({ success: true, paymentMethods, defaultPaymentMethodId: defaultPmId });
  } catch (err) {
    console.error("listPaymentMethods error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch payment methods" });
  }
};

// ─── Attach Payment Method ────────────────────────────────────────────────────
const attachPaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId, setAsDefault } = req.body;
    if (!paymentMethodId) return res.status(400).json({ success: false, message: "paymentMethodId is required" });

    const user = await User.findById(req.user._id);
    const customer = await stripeService.getOrCreateCustomer(user);

    if (!user.stripeCustomerId) {
      await User.findByIdAndUpdate(user._id, { stripeCustomerId: customer.id });
    }

    try {
      await stripeService.attachPaymentMethod(paymentMethodId, customer.id);
    } catch (attachErr) {
      // Already attached to this customer (e.g. confirmCardSetup auto-attached it) — that's fine
      if (!attachErr?.raw?.code?.includes("already_attached")) throw attachErr;
    }

    if (setAsDefault) {
      await stripeService.setDefaultPaymentMethod(customer.id, paymentMethodId);
    }

    const paymentMethods = await stripeService.listPaymentMethods(customer.id);
    res.json({ success: true, message: "Card added successfully", paymentMethods });
  } catch (err) {
    console.error("attachPaymentMethod error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to attach payment method" });
  }
};

// ─── Remove Payment Method ────────────────────────────────────────────────────
const removePaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId } = req.params;
    await stripeService.detachPaymentMethod(paymentMethodId);
    res.json({ success: true, message: "Card removed successfully" });
  } catch (err) {
    console.error("removePaymentMethod error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to remove payment method" });
  }
};

// ─── Set Default Payment Method ───────────────────────────────────────────────
const setDefaultPaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId } = req.body;
    if (!paymentMethodId) return res.status(400).json({ success: false, message: "paymentMethodId is required" });

    const user = await User.findById(req.user._id).select("stripeCustomerId");
    if (!user.stripeCustomerId) return res.status(400).json({ success: false, message: "No Stripe customer found" });

    await stripeService.setDefaultPaymentMethod(user.stripeCustomerId, paymentMethodId);
    res.json({ success: true, message: "Default payment method updated" });
  } catch (err) {
    console.error("setDefaultPaymentMethod error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to update default payment method" });
  }
};

// ─── Subscribe to a Plan ──────────────────────────────────────────────────────
// ── Helper: compute total price (base + agents) for a billing period ─────────
const calcTotalPrice = (plan, billingPeriod, agentCount) => {
  const tier = plan.pricing[billingPeriod];
  const basePrice = tier.price || 0;
  const discount = tier.discountPercent || 0;
  const agentPrice = plan.agentPrice || 0;
  const periodMultiplier = billingPeriod === "monthly" ? 1 : billingPeriod === "quarterly" ? 3 : billingPeriod === "semiannual" ? 6 : 12;
  // agentCount is the TOTAL seats (1 is always included in basePrice).
  // Only charge for seats beyond the first included one.
  const extraAgents = Math.max(0, agentCount - 1);
  const totalPerMonth = basePrice + extraAgents * agentPrice;
  const totalBeforeDiscount = totalPerMonth * periodMultiplier;
  return totalBeforeDiscount * (1 - discount / 100);
};

// Period discounts are for first-time purchases only — upgrades always use the base price.
const calcUpgradePrice = (plan, billingPeriod, agentCount) => {
  const tier = plan.pricing[billingPeriod];
  const basePrice = tier.price || 0;
  const agentPrice = plan.agentPrice || 0;
  const periodMultiplier = billingPeriod === "monthly" ? 1 : billingPeriod === "quarterly" ? 3 : billingPeriod === "semiannual" ? 6 : 12;
  const extraAgents = Math.max(0, agentCount - 1);
  return (basePrice + extraAgents * agentPrice) * periodMultiplier;
};

const subscribeToPlan = async (req, res) => {
  try {
    const { planId, billingPeriod, paymentMethodId, couponCode, agentCount: rawAgentCount } = req.body;
    const agentCount = Math.max(1, parseInt(rawAgentCount) || 1);

    if (!planId || !billingPeriod || !paymentMethodId) {
      return res.status(400).json({ success: false, message: "planId, billingPeriod, and paymentMethodId are required" });
    }
    if (!["monthly", "quarterly", "semiannual", "yearly"].includes(billingPeriod)) {
      return res.status(400).json({ success: false, message: "Invalid billing period" });
    }

    const plan = await Plan.findOne({ _id: planId, isActive: true, isDeleted: false });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const pricingTier = plan.pricing[billingPeriod];
    if (!pricingTier?.stripePriceId) {
      return res.status(400).json({ success: false, message: "This plan does not support the selected billing period" });
    }

    const user = await User.findById(req.user._id);

    // Check for existing subscription
    const existingSub = await Subscription.findOne({
      userId: user._id,
      status: { $in: ["active", "trialing", "paused", "incomplete"] },
    });
    if (existingSub) {
      if (existingSub.status === "incomplete" || existingSub.cancelAtPeriodEnd) {
        // Incomplete (unpaid) or already scheduled to cancel — cancel it on Stripe immediately and clear from DB
        if (existingSub.stripeSubscriptionId) {
          try { await stripeService.cancelSubscription(existingSub.stripeSubscriptionId, false); } catch (_) {}
        }
        await Subscription.deleteOne({ _id: existingSub._id });
      } else {
        return res.status(400).json({ success: false, message: "You already have an active subscription. Please cancel or upgrade it." });
      }
    }

    // Get or create Stripe customer
    const customer = await stripeService.getOrCreateCustomer(user);
    if (!user.stripeCustomerId) {
      await User.findByIdAndUpdate(user._id, { stripeCustomerId: customer.id });
    }

    // Attach and set default payment method (already attached cards will be a no-op on Stripe's side)
    try {
      await stripeService.attachPaymentMethod(paymentMethodId, customer.id);
    } catch (attachErr) {
      if (!attachErr?.raw?.code?.includes("already_attached")) throw attachErr;
    }
    await stripeService.setDefaultPaymentMethod(customer.id, paymentMethodId);

    // Validate coupon
    let couponId = null;
    let appliedCouponCode = null;
    if (couponCode) {
      const coupon = await Coupon.findOne({
        code: couponCode.toUpperCase(),
        isActive: true,
        isDeleted: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      });
      if (coupon) {
        couponId = coupon.stripeCouponId;
        appliedCouponCode = coupon.code;
      }
    }

    // Always start paid subscription immediately — do not inherit remaining trial period
    const trialEnd = null;

    // Calculate total price including agent seats
    const totalAmount = calcTotalPrice(plan, billingPeriod, agentCount);
    const intervalConfig = {
      monthly:    { interval: "month", intervalCount: 1 },
      quarterly:  { interval: "month", intervalCount: 3 },
      semiannual: { interval: "month", intervalCount: 6 },
      yearly:     { interval: "year",  intervalCount: 1 },
    };
    const { interval, intervalCount } = intervalConfig[billingPeriod];

    // Use dynamic price_data if agentPrice > 0 OR total differs from base price, else use stored stripePriceId
    const hasAgentPricing = (plan.agentPrice || 0) > 0;
    const usesDynamicPrice = hasAgentPricing || agentCount > 1;

    // Create Stripe subscription
    const stripeSub = await stripeService.createSubscription({
      stripeCustomerId: customer.id,
      stripePriceId: usesDynamicPrice ? null : pricingTier.stripePriceId,
      paymentMethodId,
      trialEnd,
      couponId,
      priceData: usesDynamicPrice ? { amount: totalAmount, interval, intervalCount, productName: `${plan.name} - ${agentCount} agent${agentCount !== 1 ? "s" : ""} (${billingPeriod})` } : null,
    });

    // Save subscription in DB
    const now = new Date();
    const periodStart = stripeSub.current_period_start
      ? new Date(stripeSub.current_period_start * 1000) : now;
    const periodEnd = stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000) : null;

    // Map Stripe status to our DB status
    const dbStatus = stripeSub.status === "trialing" ? "trialing"
      : stripeSub.status === "active" ? "active"
      : "incomplete";

    const subscription = await Subscription.create({
      userId: user._id,
      planId: plan._id,
      billingPeriod,
      agentCount,
      status: dbStatus,
      stripeSubscriptionId: stripeSub.id,
      stripeCustomerId: customer.id,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialStart: stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000) : null,
      trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
      couponCode: appliedCouponCode,
      stripeCouponId: couponId,
    });
    // Only mark user as active once payment is confirmed (webhook or confirmCardPayment)
    // For now set to "active" optimistically — webhook will correct if needed
    await User.findByIdAndUpdate(user._id, {
      planStatus: dbStatus === "incomplete" ? user.planStatus : "active",
      reminderEmailsSent: [],
    });

    // Save invoice to DB immediately so it shows in billing views without waiting for webhook/sync
    const stripeInvoice = stripeSub.latest_invoice;
    if (stripeInvoice && typeof stripeInvoice === "object" && stripeInvoice.id && stripeInvoice.status !== "draft") {
      try {
        const lineItem = stripeInvoice.lines?.data?.[0];
        const invPeriodStart = lineItem?.period?.start
          ? new Date(lineItem.period.start * 1000) : periodStart;
        const invPeriodEnd = lineItem?.period?.end
          ? new Date(lineItem.period.end * 1000) : periodEnd;
        await Invoice.findOneAndUpdate(
          { stripeInvoiceId: stripeInvoice.id },
          {
            userId: user._id,
            subscriptionId: subscription._id,
            planId: plan._id,
            stripeInvoiceId: stripeInvoice.id,
            stripeCustomerId: customer.id,
            stripeChargeId: stripeInvoice.charge || null,
            invoiceNumber: stripeInvoice.number || null,
            amount: stripeInvoice.amount_due,
            amountPaid: stripeInvoice.amount_paid,
            planAmount: calcPlanAmount(stripeInvoice),
            currency: stripeInvoice.currency || "usd",
            status: stripeInvoice.status,
            invoicePdf: stripeInvoice.invoice_pdf || null,
            hostedInvoiceUrl: stripeInvoice.hosted_invoice_url || null,
            billingPeriodStart: invPeriodStart,
            billingPeriodEnd: invPeriodEnd,
            stripeCreatedAt: stripeInvoice.created ? new Date(stripeInvoice.created * 1000) : new Date(),
            couponCode: appliedCouponCode || null,
          },
          { upsert: true, new: true }
        );
      } catch (invoiceErr) {
        console.error("Failed to save initial invoice to DB:", invoiceErr.message);
      }
    }

    res.status(201).json({
      success: true,
      message: "Subscription created successfully",
      subscription,
      clientSecret: stripeInvoice?.payment_intent?.client_secret || null,
    });
  } catch (err) {
    console.error("subscribeToPlan error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to create subscription" });
  }
};

// ─── Activate Subscription after payment confirmed on frontend ────────────────
const activateSubscription = async (req, res) => {
  try {
    const userId = req.user._id;
    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["incomplete", "active", "trialing"] },
    }).sort({ createdAt: -1 });

    if (!subscription) {
      return res.status(404).json({ success: false, message: "No subscription found" });
    }

    // Verify with Stripe that the subscription is now active
    if (subscription.stripeSubscriptionId) {
      const stripeSub = await stripeService.retrieveSubscription(subscription.stripeSubscriptionId);
      if (stripeSub.status === "active" || stripeSub.status === "trialing") {
        subscription.status = stripeSub.status;
        const periodStart = stripeSub.current_period_start ? new Date(stripeSub.current_period_start * 1000) : subscription.currentPeriodStart;
        const periodEnd = stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1000) : subscription.currentPeriodEnd;
        subscription.currentPeriodStart = periodStart;
        subscription.currentPeriodEnd = periodEnd;
        await subscription.save();
        await User.findByIdAndUpdate(userId, { planStatus: "active" });
      } else if (stripeSub.status === "incomplete") {
        return res.status(400).json({ success: false, message: "Payment not yet confirmed. Please try again." });
      }
    } else {
      subscription.status = "active";
      await subscription.save();
      await User.findByIdAndUpdate(userId, { planStatus: "active" });
    }

    res.json({ success: true, message: "Subscription activated", subscription });
  } catch (err) {
    console.error("activateSubscription error:", err);
    res.status(500).json({ success: false, message: "Failed to activate subscription" });
  }
};

// ─── Cancel Subscription ──────────────────────────────────────────────────────
const cancelSubscription = async (req, res) => {
  try {
    const userId = req.user._id;
    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["active", "trialing"] },
    });
    if (!subscription) return res.status(404).json({ success: false, message: "No active subscription found" });

    if (subscription.stripeSubscriptionId) {
      await stripeService.cancelSubscription(subscription.stripeSubscriptionId, true); // cancel at period end, NOT immediately
    }

    // Mark as scheduled-for-cancellation but keep status "active" — user retains access until period end.
    // planStatus stays "active" here; the Stripe webhook (customer.subscription.deleted) will
    // flip it to "cancelled" when the billing period actually ends.
    subscription.cancelAtPeriodEnd = true;
    subscription.cancelledAt = new Date();
    await subscription.save();

    res.json({ success: true, message: "Subscription will be cancelled at the end of the billing period" });
  } catch (err) {
    console.error("cancelSubscription error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to cancel subscription" });
  }
};

// ─── Upgrade / Change Plan ────────────────────────────────────────────────────
const INTERVAL_CONFIG = {
  monthly:    { interval: "month", intervalCount: 1 },
  quarterly:  { interval: "month", intervalCount: 3 },
  semiannual: { interval: "month", intervalCount: 6 },
  yearly:     { interval: "year",  intervalCount: 1 },
};

const upgradePlan = async (req, res) => {
  try {
    const { planId, billingPeriod, couponCode } = req.body;
    if (!planId || !billingPeriod) {
      return res.status(400).json({ success: false, message: "planId and billingPeriod are required" });
    }

    const plan = await Plan.findOne({ _id: planId, isActive: true, isDeleted: false });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const subscription = await Subscription.findOne({
      userId: req.user._id,
      status: { $in: ["active", "trialing"] },
    });
    if (!subscription) return res.status(404).json({ success: false, message: "No active subscription found to upgrade" });

    let updatedStripeSub = null;
    if (subscription.stripeSubscriptionId) {
      const agentCount = subscription.agentCount || 1;
      const { interval, intervalCount } = INTERVAL_CONFIG[billingPeriod];

      // Step 1: Correct the current Stripe subscription price to the undiscounted value
      // (proration_behavior "none" = no charge). This ensures Stripe's proration credit
      // is based on the undiscounted plan price, not a stale discounted price from before
      // the no-discount-on-upgrades fix.
      const currentPlanDoc = await Plan.findById(subscription.planId).lean();
      if (currentPlanDoc) {
        const currentBillingPeriod = subscription.billingPeriod;
        // Use calcTotalPrice (discounted) so Stripe's proration credit = what the user actually paid.
        const currentUndiscountedAmount = calcTotalPrice(currentPlanDoc, currentBillingPeriod, agentCount);
        const currentInterval = INTERVAL_CONFIG[currentBillingPeriod];
        const corrProduct = await stripeService.stripe.products.create({
          name: `[Correction] ${currentPlanDoc.name} (${currentBillingPeriod})`,
        });
        const corrPrice = await stripeService.stripe.prices.create({
          product: corrProduct.id,
          unit_amount: Math.round(currentUndiscountedAmount * 100),
          currency: "usd",
          recurring: { interval: currentInterval.interval, interval_count: currentInterval.intervalCount },
        });
        const currentStripeSub = await stripeService.retrieveSubscription(subscription.stripeSubscriptionId);
        const currentItemId = currentStripeSub.items?.data?.[0]?.id;
        await stripeService.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          items: [{ id: currentItemId, price: corrPrice.id }],
          proration_behavior: "none",
        });
        // Deactivate correction price/product (not needed after this)
        try {
          await stripeService.stripe.prices.update(corrPrice.id, { active: false });
          await stripeService.stripe.products.update(corrProduct.id, { active: false });
        } catch (_) {}
      }

      // Step 2: Upgrade to the new plan at undiscounted price — Stripe proration now
      // credits the correct undiscounted amount from Step 1.
      const totalAmount = calcUpgradePrice(plan, billingPeriod, agentCount); // USD, no discount
      const product = await stripeService.stripe.products.create({
        name: `${plan.name} - ${agentCount} agent${agentCount !== 1 ? "s" : ""} (${billingPeriod})`,
      });
      const newStripePrice = await stripeService.stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(totalAmount * 100),
        currency: "usd",
        recurring: { interval, interval_count: intervalCount },
      });

      // ── Calculate proration credit (same formula as previewUpgrade) ───────────
      // We need this BEFORE resolving the coupon so we can size a fixed-amount coupon correctly.
      const planTotalCents = Math.round(totalAmount * 100);
      let proratedCredit = 0;
      if (subscription.currentPeriodStart && subscription.currentPeriodEnd && currentPlanDoc) {
        const now = Date.now();
        const periodStart = new Date(subscription.currentPeriodStart).getTime();
        const periodEnd = new Date(subscription.currentPeriodEnd).getTime();
        const totalMs = Math.max(1, periodEnd - periodStart);
        const remainingMs = Math.max(0, periodEnd - now);
        const remainingFraction = remainingMs / totalMs;
        if (remainingFraction > 0) {
          const currentPaidPrice = calcTotalPrice(currentPlanDoc, subscription.billingPeriod, agentCount);
          proratedCredit = Math.round(currentPaidPrice * 100 * remainingFraction);
        }
      }
      // Net balance the user owes before any coupon discount
      const netBeforeCoupon = Math.max(0, planTotalCents - proratedCredit);

      // ── Resolve coupon and create a precisely-sized Stripe coupon ────────────
      // Problem: Stripe applies a % coupon to the SUBSCRIPTION price, then subtracts the
      // proration credit separately. This means a 50% coupon on a $174 plan gives $87 off
      // even when the user only owes $95.70 after credit — producing $8.70 instead of $47.85.
      //
      // Fix: Convert percentage coupons into a one-time FIXED-AMOUNT Stripe coupon sized to
      // exactly (netBalance × discountPct). Stripe then computes:
      //   planTotal − fixedDiscount − credit = (planTotal − credit) × (1 − pct)  ✓
      let upgradeCouponDoc = null;
      let upgradeCouponId = null;        // the Stripe coupon ID to pass in step 2
      let dynamicCouponId = null;        // track if we created a temporary coupon to clean up
      if (couponCode) {
        try {
          upgradeCouponDoc = await Coupon.findOne({
            code: couponCode.toUpperCase(),
            isActive: true,
            isDeleted: false,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
          });
          if (upgradeCouponDoc) {
            if (upgradeCouponDoc.discountType === "percentage" && netBeforeCoupon > 0) {
              // Create a one-time fixed-amount coupon equal to pct% of the net balance
              const fixedDiscountCents = Math.round(netBeforeCoupon * upgradeCouponDoc.discountValue / 100);
              if (fixedDiscountCents > 0) {
                const dynCoupon = await stripeService.stripe.coupons.create({
                  amount_off: fixedDiscountCents,
                  currency: "usd",
                  duration: "once",
                  name: `${upgradeCouponDoc.discountValue}% off upgrade (${upgradeCouponDoc.code})`,
                });
                upgradeCouponId = dynCoupon.id;
                dynamicCouponId = dynCoupon.id;
              }
            } else if (upgradeCouponDoc.discountType === "fixed" && upgradeCouponDoc.stripeCouponId) {
              // Fixed-amount coupons: order doesn't matter (a+b+c = a+c+b), use directly
              upgradeCouponId = upgradeCouponDoc.stripeCouponId;
            }
          }
        } catch (couponErr) {
          console.warn("Could not resolve upgrade coupon:", couponErr.message);
        }
      }

      // Re-fetch after Step 1 to get the updated item ID
      const refreshedSub = await stripeService.retrieveSubscription(subscription.stripeSubscriptionId);
      const updatedItemId = refreshedSub.items?.data?.[0]?.id;

      const step2Params = {
        items: [{ id: updatedItemId, price: newStripePrice.id }],
        proration_behavior: "always_invoice",
        expand: ["latest_invoice.lines"],
      };
      // Always pass the coupon in step 2 (replaces any existing % coupon on the subscription).
      // For % coupons this is the dynamically-sized fixed-amount coupon; for fixed coupons it's
      // the original. Not passing it means Stripe may auto-fire the old % coupon from the sub.
      if (upgradeCouponId) step2Params.coupon = upgradeCouponId;

      updatedStripeSub = await stripeService.stripe.subscriptions.update(
        subscription.stripeSubscriptionId,
        step2Params
      );

      // Track coupon usage now that the invoice is created
      if (upgradeCouponDoc) {
        try {
          const invoiceId = updatedStripeSub?.latest_invoice?.id || null;
          upgradeCouponDoc.timesUsed = (upgradeCouponDoc.timesUsed || 0) + 1;
          upgradeCouponDoc.usageHistory.push({ userId: req.user._id, usedAt: new Date(), invoiceId });
          if (upgradeCouponDoc.maxUses && upgradeCouponDoc.timesUsed >= upgradeCouponDoc.maxUses) {
            upgradeCouponDoc.isActive = false;
          }
          await upgradeCouponDoc.save();
        } catch (trackErr) {
          console.warn("Coupon usage tracking failed:", trackErr.message);
        }
      }

      // Clean up the dynamic fixed-amount coupon we created (it was one-time use only)
      if (dynamicCouponId) {
        try { await stripeService.stripe.coupons.del(dynamicCouponId); } catch (_) {}
      }

      // Save the upgrade invoice immediately so it carries the NEW plan's ID.
      const latestInvoice = updatedStripeSub?.latest_invoice;
      if (latestInvoice && typeof latestInvoice === "object" && latestInvoice.id) {
        const lines = latestInvoice.lines?.data || [];
        const mainLineItem =
          lines.find((li) => !li.proration && (li.amount || 0) >= 0) ||
          lines.find((li) => (li.amount || 0) >= 0) ||
          lines[0];
        const periodStart = mainLineItem?.period?.start ? new Date(mainLineItem.period.start * 1000) : null;
        const periodEnd = mainLineItem?.period?.end ? new Date(mainLineItem.period.end * 1000) : null;

        await Invoice.findOneAndUpdate(
          { stripeInvoiceId: latestInvoice.id },
          {
            $set: {
              userId: req.user._id,
              subscriptionId: subscription._id,
              planId: plan._id,
              stripeInvoiceId: latestInvoice.id,
              stripeCustomerId: subscription.stripeCustomerId,
              stripeChargeId: latestInvoice.charge || null,
              invoiceNumber: latestInvoice.number || null,
              amount: latestInvoice.amount_due,
              amountPaid: latestInvoice.amount_paid,
              planAmount: calcPlanAmount(latestInvoice),
              currency: latestInvoice.currency || "usd",
              status: latestInvoice.status,
              invoicePdf: latestInvoice.invoice_pdf || null,
              hostedInvoiceUrl: latestInvoice.hosted_invoice_url || null,
              billingPeriodStart: periodStart,
              billingPeriodEnd: periodEnd,
              stripeCreatedAt: latestInvoice.created ? new Date(latestInvoice.created * 1000) : new Date(),
            },
          },
          { upsert: true, new: true }
        );
      }
    }

    subscription.planId = plan._id;
    subscription.billingPeriod = billingPeriod;
    // Update period dates from Stripe so the UI shows the correct renewal date
    if (updatedStripeSub?.current_period_start) {
      subscription.currentPeriodStart = new Date(updatedStripeSub.current_period_start * 1000);
    }
    if (updatedStripeSub?.current_period_end) {
      subscription.currentPeriodEnd = new Date(updatedStripeSub.current_period_end * 1000);
    }
    await subscription.save();

    // Populate planId so the response mirrors getCurrentSubscription
    await subscription.populate("planId");

    res.json({ success: true, message: "Plan changed successfully", subscription });
  } catch (err) {
    console.error("upgradePlan error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to upgrade subscription" });
  }
};

// ─── Preview Plan Change (show prorated charge before upgrading) ──────────────
const previewUpgrade = async (req, res) => {
  try {
    const { planId, billingPeriod, couponCode } = req.body;
    if (!planId || !billingPeriod) {
      return res.status(400).json({ success: false, message: "planId and billingPeriod are required" });
    }

    const plan = await Plan.findOne({ _id: planId, isActive: true, isDeleted: false });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const pricingTier = plan.pricing?.[billingPeriod];
    if (!pricingTier?.price) {
      return res.status(400).json({ success: false, message: "Plan does not support this billing period" });
    }

    const subscription = await Subscription.findOne({
      userId: req.user._id,
      status: { $in: ["active", "trialing"] },
    });
    if (!subscription) {
      return res.status(404).json({ success: false, message: "No active subscription found" });
    }

    // Use calcUpgradePrice — no period discount for upgrades (first-purchase only).
    const agentCount = subscription.agentCount || 1;
    const totalAmount = calcUpgradePrice(plan, billingPeriod, agentCount); // USD, no discount
    const planTotalCents = Math.round(totalAmount * 100);

    // Manual proration: credit = remaining fraction × undiscounted current-plan price.
    let negativeAmount = 0;
    let isProrated = false;

    if (subscription.stripeSubscriptionId && subscription.currentPeriodStart && subscription.currentPeriodEnd) {
      const now = Date.now();
      const periodStart = new Date(subscription.currentPeriodStart).getTime();
      const periodEnd = new Date(subscription.currentPeriodEnd).getTime();
      const totalMs = Math.max(1, periodEnd - periodStart);
      const remainingMs = Math.max(0, periodEnd - now);
      const remainingFraction = remainingMs / totalMs;

      const currentPlan = await Plan.findById(subscription.planId).lean();
      if (currentPlan && remainingFraction > 0) {
        const currentPaidPrice = calcTotalPrice(currentPlan, subscription.billingPeriod, agentCount);
        negativeAmount = Math.round(currentPaidPrice * 100 * remainingFraction);
        isProrated = true;
      }
    }

    // ── Apply coupon to the REMAINING balance (after proration credit) ──────────
    // The coupon discounts what the subscriber actually owes after their unused-time
    // credit has been deducted — not the gross plan price.
    // Order: remainingBalance = planTotal - proratedCredit
    //        couponDiscount   = remainingBalance × discountPct  (or fixed amt)
    //        charged          = remainingBalance - couponDiscount
    let couponDiscount = 0;
    let appliedCouponData = null;

    // Compute net balance before coupon (may be 0 if credit covers full plan)
    const netBeforeCoupon = Math.max(0, planTotalCents - negativeAmount);

    if (couponCode) {
      const coupon = await Coupon.findOne({
        code: couponCode.toUpperCase(),
        isActive: true,
        isDeleted: false,
        $and: [
          { $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] },
          { $or: [{ maxUses: null }, { $expr: { $lt: ["$timesUsed", "$maxUses"] } }] },
        ],
      });
      if (coupon) {
        if (coupon.discountType === "percentage") {
          // Apply to remaining balance after proration credit
          couponDiscount = Math.round(netBeforeCoupon * (coupon.discountValue / 100));
        } else {
          couponDiscount = Math.min(netBeforeCoupon, Math.round(coupon.discountValue * 100));
        }
        appliedCouponData = {
          code: coupon.code,
          discountType: coupon.discountType,
          discountValue: coupon.discountValue,
          isRetentionCoupon: coupon.isRetentionCoupon,
        };
      }
    }

    const amountDueNow = Math.max(0, netBeforeCoupon - couponDiscount);

    return res.json({
      success: true,
      planTotal: planTotalCents,             // cents — full new plan charge
      proratedCredit: negativeAmount,        // cents — credit for unused time
      couponDiscount,                        // cents — coupon discount applied
      appliedCoupon: appliedCouponData,      // coupon metadata (or null)
      amountDueNow,                          // cents — final charge after proration + coupon
      billingPeriod,
      isProrated,
      periodEnd: subscription.currentPeriodEnd,
    });
  } catch (err) {
    console.error("previewUpgrade error:", err);
    res.status(500).json({ success: false, message: "Failed to preview upgrade" });
  }
};

// ─── Sync invoices from Stripe into local DB ──────────────────────────────────
const syncStripeInvoices = async (userId, stripeCustomerId) => {
  try {
    const subscription = await Subscription.findOne({ userId }).sort({ createdAt: -1 });
    let allInvoices = [];
    let hasMore = true;
    let startingAfter = null;
    while (hasMore) {
      const result = await stripeService.listInvoices(stripeCustomerId, 100, startingAfter);
      allInvoices = allInvoices.concat(result.data);
      hasMore = result.has_more;
      if (hasMore && result.data.length > 0) {
        startingAfter = result.data[result.data.length - 1].id;
      } else {
        hasMore = false;
      }
    }
    // Pre-load all active plans once for period-based planId correction.
    const allPlans = await Plan.find({ isDeleted: false }).lean();

    // Derive billing period from invoice period date range.
    const detectBillingPeriod = (start, end) => {
      if (!start || !end) return null;
      const days = (end - start) / (1000 * 60 * 60 * 24);
      if (days <= 35) return "monthly";
      if (days <= 100) return "quarterly";
      if (days <= 200) return "semiannual";
      return "yearly";
    };

    for (const si of allInvoices) {
      if (si.status === "draft") continue;

      // Pick the main (non-proration, positive) line item for the billing period.
      // Proration invoices have multiple line items: the positive one is the new plan charge
      // and the negative one is the credit for unused time on the old plan.
      // We want the new plan's period, not the credit period.
      const lines = si.lines?.data || [];
      const mainLineItem =
        lines.find((li) => !li.proration && (li.amount || 0) >= 0) ||
        lines.find((li) => (li.amount || 0) >= 0) ||
        lines[0];

      const periodStart = mainLineItem?.period?.start
        ? new Date(mainLineItem.period.start * 1000)
        : (si.period_start ? new Date(si.period_start * 1000) : null);
      const periodEnd = mainLineItem?.period?.end
        ? new Date(mainLineItem.period.end * 1000)
        : (si.period_end ? new Date(si.period_end * 1000) : null);

      // Determine correct planId for this invoice based on its billing period length.
      // This corrects historical invoices whose planId was overwritten by a late webhook
      // after the user had already upgraded to a newer plan.
      const invoicePeriod = detectBillingPeriod(periodStart, periodEnd);
      let correctPlanId = subscription?.planId || null;
      if (invoicePeriod && allPlans.length > 0) {
        // If the current subscription's plan supports this billing period, use it.
        // Otherwise find a plan that does (handles cases where each period is a separate plan doc).
        const currentPlan = allPlans.find((p) => String(p._id) === String(subscription?.planId));
        const currentPlanSupports = currentPlan?.pricing?.[invoicePeriod]?.price > 0;
        if (!currentPlanSupports) {
          const matchingPlan = allPlans.find((p) => (p.pricing?.[invoicePeriod]?.price || 0) > 0);
          if (matchingPlan) correctPlanId = matchingPlan._id;
        }
      }

      await Invoice.findOneAndUpdate(
        { stripeInvoiceId: si.id },
        {
          // Always update mutable fields (status, amounts, PDF links, etc.)
          $set: {
            userId,
            subscriptionId: subscription?._id || null,
            planId: correctPlanId,   // always correct planId based on period detection
            stripeInvoiceId: si.id,
            stripeCustomerId,
            stripeChargeId: si.charge || null,
            invoiceNumber: si.number || null,
            amount: si.amount_due,
            amountPaid: si.amount_paid,
            planAmount: calcPlanAmount(si),
            currency: si.currency,
            status: si.status,
            invoicePdf: si.invoice_pdf || null,
            hostedInvoiceUrl: si.hosted_invoice_url || null,
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
            stripeCreatedAt: si.created ? new Date(si.created * 1000) : null,
          },
        },
        { upsert: true, new: true }
      );
    }
  } catch (err) {
    console.error("syncStripeInvoices error:", err.message);
  }
};

// ─── Get Agent Quota (how many seats bought vs used) ─────────────────────────
const getAgentQuota = async (req, res) => {
  try {
    const userId = req.user._id;
    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["active", "trialing"] },
    }).populate("planId", "name agentPrice");

    const usedCount = await User.countDocuments({
      createdByWhichCompanyAdmin: userId,
      role: "user",
      accountStatus: { $ne: "deleted" },
    });

    // Trial users get 1 free agent seat
    if (!subscription) {
      const user = await User.findById(userId).select("planStatus");
      const allowedCount = user?.planStatus === "trial" ? 1 : 0;
      return res.json({ success: true, agentCount: allowedCount, usedCount, remaining: Math.max(0, allowedCount - usedCount), onTrial: true });
    }

    const agentCount = subscription.agentCount || 1;
    res.json({
      success: true,
      agentCount,
      usedCount,
      remaining: Math.max(0, agentCount - usedCount),
      agentPrice: subscription.planId?.agentPrice || 0,
      billingPeriod: subscription.billingPeriod,
    });
  } catch (err) {
    console.error("getAgentQuota error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch agent quota" });
  }
};

// ─── Preview Agent Seat Cost (prorated, no charge) ───────────────────────────
const previewAgentSeats = async (req, res) => {
  try {
    const { agentCount: rawAgentCount } = req.body;
    const newAgentCount = Math.max(1, parseInt(rawAgentCount) || 1);
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["active", "trialing"] },
    }).populate("planId");

    if (!subscription) {
      return res.status(404).json({ success: false, message: "No active subscription found" });
    }
    if (newAgentCount <= subscription.agentCount) {
      return res.status(400).json({ success: false, message: "New count must be greater than current" });
    }

    const plan = subscription.planId;
    const newTotal = calcTotalPrice(plan, subscription.billingPeriod, newAgentCount);
    const oldTotal = calcTotalPrice(plan, subscription.billingPeriod, subscription.agentCount);
    const additionalPerPeriod = newTotal - oldTotal;

    // Calculate prorated amount using Stripe upcoming invoice
    let proratedAmount = null;
    if (subscription.stripeSubscriptionId) {
      try {
        const intervalConfig = {
          monthly:   { interval: "month", intervalCount: 1 },
          quarterly: { interval: "month", intervalCount: 3 },
          yearly:    { interval: "year",  intervalCount: 1 },
        };
        const { interval, intervalCount } = intervalConfig[subscription.billingPeriod];
        const product = await stripeService.stripe.products.create({
          name: `Preview - ${plan.name} ${newAgentCount} agents`,
        });
        const newPrice = await stripeService.stripe.prices.create({
          product: product.id,
          unit_amount: Math.round(newTotal * 100),
          currency: "usd",
          recurring: { interval, interval_count: intervalCount },
        });
        const stripeSub = await stripeService.retrieveSubscription(subscription.stripeSubscriptionId);
        const existingItemId = stripeSub.items?.data?.[0]?.id;
        const upcoming = await stripeService.stripe.invoices.retrieveUpcoming({
          customer: subscription.stripeCustomerId,
          subscription: subscription.stripeSubscriptionId,
          subscription_items: [{ id: existingItemId, price: newPrice.id }],
        });
        proratedAmount = upcoming.amount_due; // cents
        // Clean up temp price/product
        await stripeService.stripe.prices.update(newPrice.id, { active: false });
        await stripeService.stripe.products.update(product.id, { active: false });
      } catch (_) {
        // fallback: just show the additional monthly cost
      }
    }

    res.json({
      success: true,
      currentAgentCount: subscription.agentCount,
      newAgentCount,
      additionalPerPeriod, // USD, per billing period
      proratedAmount,       // cents, what they'll be charged now
      billingPeriod: subscription.billingPeriod,
      agentPrice: plan.agentPrice || 0,
    });
  } catch (err) {
    console.error("previewAgentSeats error:", err);
    res.status(500).json({ success: false, message: "Failed to preview agent seat cost" });
  }
};

// ─── Update Agent Seats (increase agent count on active subscription) ─────────
const updateAgentSeats = async (req, res) => {
  try {
    const { agentCount: rawAgentCount, couponCode } = req.body;
    const newAgentCount = Math.max(1, parseInt(rawAgentCount) || 1);
    const userId = req.user._id;

    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["active", "trialing", "incomplete"] },
    }).populate("planId");

    if (!subscription) {
      return res.status(404).json({ success: false, message: "No active subscription found" });
    }

    // Verify Stripe status — incomplete subscriptions cannot be modified
    if (subscription.stripeSubscriptionId) {
      const stripeSub = await stripeService.retrieveSubscription(subscription.stripeSubscriptionId);
      if (stripeSub.status === "incomplete") {
        return res.status(400).json({
          success: false,
          message: "Your subscription payment is not yet confirmed. Please complete your initial payment before adding more seats.",
        });
      }
      // Sync status if Stripe says active but DB says incomplete
      if (stripeSub.status === "active" && subscription.status === "incomplete") {
        subscription.status = "active";
        await subscription.save();
        await User.findByIdAndUpdate(userId, { planStatus: "active" });
      }
    }

    if (newAgentCount < subscription.agentCount) {
      return res.status(400).json({ success: false, message: "Cannot reduce agent count on an active subscription. Please cancel and resubscribe." });
    }

    const plan = subscription.planId;
    const newTotal = calcTotalPrice(plan, subscription.billingPeriod, newAgentCount);
    const intervalConfig = {
      monthly:    { interval: "month", intervalCount: 1 },
      quarterly:  { interval: "month", intervalCount: 3 },
      semiannual: { interval: "month", intervalCount: 6 },
      yearly:     { interval: "year",  intervalCount: 1 },
    };
    const { interval, intervalCount } = intervalConfig[subscription.billingPeriod];

    // Resolve coupon if provided
    let stripeCouponId = null;
    if (couponCode) {
      const coupon = await Coupon.findOne({
        code: couponCode.toUpperCase(),
        isActive: true,
        isDeleted: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      });
      if (coupon) stripeCouponId = coupon.stripeCouponId;
    }

    // Update Stripe subscription with new price_data
    if (subscription.stripeSubscriptionId) {
      const stripeSub = await stripeService.retrieveSubscription(subscription.stripeSubscriptionId);
      const existingItemId = stripeSub.items?.data?.[0]?.id;
      const product = await stripeService.stripe.products.create({
        name: `${plan.name} - ${newAgentCount} agent${newAgentCount !== 1 ? "s" : ""} (${subscription.billingPeriod})`,
      });
      const newPrice = await stripeService.stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(newTotal * 100),
        currency: "usd",
        recurring: { interval, interval_count: intervalCount },
      });
      const updateParams = {
        items: [{ id: existingItemId, price: newPrice.id }],
        proration_behavior: "always_invoice",
        expand: ["latest_invoice.payment_intent"],
      };
      if (stripeCouponId) updateParams.discounts = [{ coupon: stripeCouponId }];
      const updatedSub = await stripeService.stripe.subscriptions.update(subscription.stripeSubscriptionId, updateParams);

      // "always_invoice" creates a new invoice immediately — pay it if not already paid
      const latestInvoice = updatedSub.latest_invoice;
      let clientSecret = null;
      let finalInvoice = latestInvoice;

      if (latestInvoice && latestInvoice.amount_due > 0 && latestInvoice.status !== "paid") {
        try {
          finalInvoice = await stripeService.stripe.invoices.pay(latestInvoice.id, {
            expand: ["lines.data"],
          });
          if (finalInvoice.status !== "paid") {
            clientSecret = latestInvoice.payment_intent?.client_secret || null;
          }
        } catch (payErr) {
          // Payment requires action — return clientSecret for frontend confirmation
          clientSecret = latestInvoice.payment_intent?.client_secret || null;
          // Fetch finalized invoice for DB save even if payment requires action
          try {
            finalInvoice = await stripeService.stripe.invoices.retrieve(latestInvoice.id, {
              expand: ["lines.data"],
            });
          } catch (_) {}
        }
      }

      // Save invoice to DB immediately so it appears in companyAdmin and superAdmin
      if (finalInvoice && finalInvoice.id && finalInvoice.status !== "draft") {
        const lineItem = finalInvoice.lines?.data?.[0];
        const periodStart = lineItem?.period?.start
          ? new Date(lineItem.period.start * 1000)
          : (subscription.currentPeriodStart || null);
        const periodEnd = lineItem?.period?.end
          ? new Date(lineItem.period.end * 1000)
          : (subscription.currentPeriodEnd || null);
        await Invoice.findOneAndUpdate(
          { stripeInvoiceId: finalInvoice.id },
          {
            userId,
            subscriptionId: subscription._id,
            planId: subscription.planId._id || subscription.planId,
            stripeInvoiceId: finalInvoice.id,
            stripeCustomerId: subscription.stripeCustomerId,
            stripeChargeId: finalInvoice.charge || null,
            invoiceNumber: finalInvoice.number || null,
            amount: finalInvoice.amount_due,
            amountPaid: finalInvoice.amount_paid,
            planAmount: calcPlanAmount(finalInvoice),
            currency: finalInvoice.currency || "usd",
            status: finalInvoice.status,
            invoicePdf: finalInvoice.invoice_pdf || null,
            hostedInvoiceUrl: finalInvoice.hosted_invoice_url || null,
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
            stripeCreatedAt: finalInvoice.created ? new Date(finalInvoice.created * 1000) : new Date(),
            couponCode: couponCode || null,
          },
          { upsert: true, new: true }
        );
      }

      subscription.agentCount = newAgentCount;
      await subscription.save();
      return res.json({ success: true, message: `Agent seats updated to ${newAgentCount}`, subscription, clientSecret });
    }

    subscription.agentCount = newAgentCount;
    await subscription.save();

    res.json({ success: true, message: `Agent seats updated to ${newAgentCount}`, subscription, clientSecret: null });
  } catch (err) {
    console.error("updateAgentSeats error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to update agent seats" });
  }
};

// ─── Get Invoices ─────────────────────────────────────────────────────────────
const getInvoices = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const userId = req.user._id;

    const user = await User.findById(userId).select("stripeCustomerId");

    // Sync from Stripe if user has a Stripe customer (covers local dev without webhooks)
    if (user?.stripeCustomerId) {
      await syncStripeInvoices(userId, user.stripeCustomerId);
    }

    const [invoices, total] = await Promise.all([
      Invoice.find({ userId }).sort({ stripeCreatedAt: -1, createdAt: -1 }).skip(skip).limit(parseInt(limit)).populate("planId", "name"),
      Invoice.countDocuments({ userId }),
    ]);

    // Billing summary — cast to ObjectId for aggregate
    const userObjId = new mongoose.Types.ObjectId(userId.toString());
    const summary = await Invoice.aggregate([
      { $match: { userId: userObjId, status: { $in: ["paid", "open", "uncollectible"] } } },
      { $group: { _id: null, totalPaid: { $sum: "$amountPaid" }, totalDue: { $sum: "$amount" }, totalBills: { $sum: 1 } } },
    ]);

    const { totalPaid = 0, totalDue = 0, totalBills = 0 } = summary[0] || {};

    res.json({
      success: true,
      invoices,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
      summary: { totalPaid, totalDue, totalBills },
    });
  } catch (err) {
    console.error("getInvoices error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch invoices" });
  }
};

// ─── Stripe Webhook Handler ───────────────────────────────────────────────────
const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, sig);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: "Webhook error: " + err.message });
  }

  try {
    switch (event.type) {
      case "invoice.paid": {
        const stripeInvoice = event.data.object;
        const customerId = stripeInvoice.customer;
        const user = await User.findOne({ stripeCustomerId: customerId });
        if (!user) break;

        const sub = await Subscription.findOne({ stripeSubscriptionId: stripeInvoice.subscription });

        // Use line item period for accurate subscription dates
        const wLineItem = stripeInvoice.lines?.data?.[0];
        const wPeriodStart = wLineItem?.period?.start
          ? new Date(wLineItem.period.start * 1000)
          : (stripeInvoice.period_start ? new Date(stripeInvoice.period_start * 1000) : null);
        const wPeriodEnd = wLineItem?.period?.end
          ? new Date(wLineItem.period.end * 1000)
          : (stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000) : null);

        // Upsert invoice — planId only on INSERT to avoid overwriting historical invoices
        // when a delayed webhook fires after the user has already upgraded to a new plan.
        await Invoice.findOneAndUpdate(
          { stripeInvoiceId: stripeInvoice.id },
          {
            $set: {
              userId: user._id,
              subscriptionId: sub?._id || null,
              stripeInvoiceId: stripeInvoice.id,
              stripeCustomerId: customerId,
              stripeChargeId: stripeInvoice.charge || null,
              invoiceNumber: stripeInvoice.number || null,
              amount: stripeInvoice.amount_due,
              amountPaid: stripeInvoice.amount_paid,
              planAmount: calcPlanAmount(stripeInvoice),
              currency: stripeInvoice.currency,
              status: stripeInvoice.status,
              invoicePdf: stripeInvoice.invoice_pdf || null,
              hostedInvoiceUrl: stripeInvoice.hosted_invoice_url || null,
              billingPeriodStart: wPeriodStart,
              billingPeriodEnd: wPeriodEnd,
              stripeCreatedAt: stripeInvoice.created ? new Date(stripeInvoice.created * 1000) : null,
            },
            $setOnInsert: {
              planId: sub?.planId || null,
            },
          },
          { upsert: true, new: true }
        );

        if (sub) {
          sub.status = "active";
          sub.lastInvoiceId = stripeInvoice.id;
          if (stripeInvoice.period_end) {
            sub.currentPeriodEnd = new Date(stripeInvoice.period_end * 1000);
          }
          await sub.save();
          await User.findByIdAndUpdate(user._id, { planStatus: "active" });
        }

        // ── Track retention coupon usage ─────────────────────────────────────
        // Stripe may return discount on invoice.discount (legacy) or invoice.discounts[] (newer API).
        const discountCouponId =
          stripeInvoice?.discount?.coupon?.id ||
          stripeInvoice?.discounts?.[0]?.coupon?.id ||
          stripeInvoice?.discounts?.[0]?.id; // sometimes just the coupon id string
        if (discountCouponId) {
          try {
            const retentionCoupon = await Coupon.findOne({
              stripeCouponId: discountCouponId,
              isRetentionCoupon: true,
              isDeleted: false,
            });
            if (retentionCoupon) {
              retentionCoupon.timesUsed = (retentionCoupon.timesUsed || 0) + 1;
              retentionCoupon.usageHistory.push({
                userId: user._id,
                usedAt: new Date(),
                invoiceId: stripeInvoice.id,
              });
              // Deactivate after 1 use
              if (retentionCoupon.maxUses && retentionCoupon.timesUsed >= retentionCoupon.maxUses) {
                retentionCoupon.isActive = false;
              }
              await retentionCoupon.save();
            }
          } catch (couponTrackErr) {
            console.warn("Retention coupon usage tracking failed:", couponTrackErr.message);
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const stripeInvoice = event.data.object;
        const user = await User.findOne({ stripeCustomerId: stripeInvoice.customer });
        if (!user) break;

        await Invoice.findOneAndUpdate(
          { stripeInvoiceId: stripeInvoice.id },
          { status: "open", amountPaid: 0 },
          { upsert: false }
        );
        break;
      }

      case "customer.subscription.deleted": {
        const stripeSub = event.data.object;
        const subscription = await Subscription.findOne({ stripeSubscriptionId: stripeSub.id });
        if (!subscription) break;

        subscription.status = "expired";
        subscription.cancelledAt = new Date();
        await subscription.save();

        await User.findByIdAndUpdate(subscription.userId, { planStatus: "expired" });
        break;
      }

      case "customer.subscription.updated": {
        const stripeSub = event.data.object;
        const subscription = await Subscription.findOne({ stripeSubscriptionId: stripeSub.id });
        if (!subscription) break;

        if (stripeSub.status === "active") {
          subscription.status = "active";
          subscription.currentPeriodStart = new Date(stripeSub.current_period_start * 1000);
          subscription.currentPeriodEnd = new Date(stripeSub.current_period_end * 1000);
          await subscription.save();
          await User.findByIdAndUpdate(subscription.userId, { planStatus: "active" });
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
  }

  res.json({ received: true });
};

// ─── Get My Retention Coupon ──────────────────────────────────────────────────
// Returns the caller's active, unused retention coupon (if any).
const getMyRetentionCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findOne({
      generatedForUserId: req.user._id,
      isRetentionCoupon: true,
      isDeleted: false,
      isActive: true,
    });
    res.json({ success: true, coupon: coupon || null });
  } catch (err) {
    console.error("getMyRetentionCoupon error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch retention coupon" });
  }
};

// ─── Get Retention Settings (public — billing route) ──────────────────────────
const getRetentionSettings = async (req, res) => {
  try {
    let settings = await GlobalSettings.findOne({ key: "global" });
    if (!settings) settings = await GlobalSettings.create({ key: "global" });

    // Also return the user's existing retention coupon (if any) so the
    // frontend knows on page load whether to skip the offer screen.
    const existingCoupon = await Coupon.findOne({
      generatedForUserId: req.user._id,
      isRetentionCoupon: true,
    }).lean();

    const couponUsed = existingCoupon && (existingCoupon.timesUsed || 0) >= 1;
    const firstUsedAt = existingCoupon?.usageHistory?.[0]?.usedAt || null;

    res.json({
      success: true,
      retentionDiscountPercent: settings.retentionDiscountPercent,
      // Retention coupon lifecycle flags — used by frontend to skip offer screen on repeat cancellations
      retentionCoupon: {
        hasGenerated: !!existingCoupon,             // user generated a coupon at some point
        hasUsed: couponUsed,                        // user actually used it (applied to a payment)
        generatedAt: existingCoupon?.createdAt || null,
        usedAt: firstUsedAt,
      },
      existingRetentionCoupon: existingCoupon
        ? {
            _id: existingCoupon._id,
            code: existingCoupon.code,
            discountValue: existingCoupon.discountValue,
            discountType: existingCoupon.discountType,
            timesUsed: existingCoupon.timesUsed || 0,
            maxUses: existingCoupon.maxUses || 1,
            isActive: existingCoupon.isActive,
          }
        : null,
    });
  } catch (err) {
    console.error("getRetentionSettings error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch retention settings" });
  }
};

// ─── Generate Retention Coupon ─────────────────────────────────────────────────
// Called when an existing subscriber clicks "Avail Offer" in the cancel flow.
// Rules:
//   • 1 retention coupon per user lifetime
//   • 1-time use only (maxUses = 1)
//   • Code = first 4 chars of firstname (uppercase) + discount% (e.g. WAQA40)
//   • Auto-applied to user's Stripe subscription so it fires on the next renewal
const generateRetentionCoupon = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Enforce lifetime limit — one retention coupon per user
    // Return 200 (not 400) so the frontend treats it as a normal success and shows the coupon.
    // Do NOT filter by isDeleted — a soft-deleted coupon still counts as "already availed".
    const existing = await Coupon.findOne({
      generatedForUserId: userId,
      isRetentionCoupon: true,
    });
    if (existing) {
      return res.json({
        success: true,
        alreadyExisted: true,
        message: "You have already availed the retention offer.",
        coupon: {
          _id: existing._id,
          code: existing.code,
          discountValue: existing.discountValue,
          discountType: existing.discountType,
        },
      });
    }

    // 2. Load global discount %
    let settings = await GlobalSettings.findOne({ key: "global" });
    if (!settings) settings = await GlobalSettings.create({ key: "global" });
    const discountPercent = settings.retentionDiscountPercent;

    // 3. Build coupon code (first 4 chars of firstname + discount%, e.g. WAQA40)
    const user = await User.findById(userId).select("firstname");
    const namePrefix = ((user?.firstname || "USER").replace(/\s+/g, "").toUpperCase() + "XXXX").slice(0, 4);
    let code = `${namePrefix}${discountPercent}`;

    // Handle collisions — check ALL documents (including soft-deleted) because the unique
    // index on `code` covers every document regardless of isDeleted status.
    let collision = await Coupon.findOne({ code });
    let attempt = 0;
    while (collision && attempt < 10) {
      const suffix = Math.random().toString(36).slice(2, 4).toUpperCase();
      code = `${namePrefix}${discountPercent}${suffix}`;
      collision = await Coupon.findOne({ code });
      attempt++;
    }

    // 4. Create Stripe coupon (percentage, once — DB enforces 1-use via maxUses)
    // Do NOT set max_redemptions on the Stripe coupon: we apply it to the subscription in step 7,
    // which Stripe counts as a redemption. If max_redemptions were 1 it would be exhausted before
    // the user even uses it for an upgrade, causing "Coupon is used up" errors.
    const stripeCoupon = await stripeService.stripe.coupons.create({
      name: `${discountPercent}% Retention Offer`,
      percent_off: discountPercent,
      duration: "once",
    });

    // 5. Create Stripe promotion code (optional — non-fatal if the code already exists in Stripe)
    let stripePromoCode = null;
    try {
      stripePromoCode = await stripeService.stripe.promotionCodes.create({
        coupon: stripeCoupon.id,
        code,
        max_redemptions: 1,
      });
    } catch (promoErr) {
      // A promo code with this exact code may already exist in Stripe from a previous test.
      // This is non-fatal — the stripeCouponId is what we actually use for subscription upgrades.
      console.warn("Could not create Stripe promo code (may already exist):", promoErr.message);
    }

    // 6. Save to DB
    const coupon = await Coupon.create({
      name: `${discountPercent}% Retention Offer for ${user?.firstname || userId}`,
      code,
      discountType: "percentage",
      discountValue: discountPercent,
      isActive: true,
      isRetentionCoupon: true,
      generatedForUserId: userId,
      maxUses: 1,
      timesUsed: 0,
      stripeCouponId: stripeCoupon.id,
      stripePromotionCodeId: stripePromoCode?.id || null,
    });

    // 7. Apply to user's current Stripe subscription so it auto-fires on next renewal
    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["active", "trialing"] },
    });
    if (subscription?.stripeSubscriptionId) {
      try {
        await stripeService.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          coupon: stripeCoupon.id,
        });
      } catch (stripeErr) {
        console.warn("Could not apply retention coupon to Stripe subscription:", stripeErr.message);
        // Non-fatal — coupon is still saved, user can apply manually
      }
    }

    res.json({
      success: true,
      message: `Your ${discountPercent}% discount has been applied to your next billing cycle!`,
      coupon: {
        _id: coupon._id,
        code: coupon.code,
        discountValue: coupon.discountValue,
        discountType: coupon.discountType,
      },
    });
  } catch (err) {
    console.error("generateRetentionCoupon error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to generate retention coupon" });
  }
};

// ─── Toggle Auto-Renewal ────────────────────────────────────────────────────────
// POST /billing/toggle-auto-renewal  { autoRenew: true | false }
const toggleAutoRenewal = async (req, res) => {
  try {
    const userId = req.user._id;
    const { autoRenew } = req.body;
    if (typeof autoRenew !== "boolean") {
      return res.status(400).json({ success: false, message: "autoRenew (boolean) is required" });
    }

    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["active", "trialing"] },
    });
    if (!subscription) {
      return res.status(404).json({ success: false, message: "No active subscription found" });
    }

    // cancelAtPeriodEnd = true means auto-renewal is OFF (will cancel at end of period)
    const cancelAtPeriodEnd = !autoRenew;

    // Update Stripe if a real Stripe subscription exists
    if (subscription.stripeSubscriptionId) {
      await stripeService.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: cancelAtPeriodEnd,
      });
    }

    subscription.cancelAtPeriodEnd = cancelAtPeriodEnd;
    if (!cancelAtPeriodEnd) {
      subscription.cancelledAt = null; // un-cancel
    }
    await subscription.save();

    res.json({
      success: true,
      autoRenew,
      message: autoRenew
        ? "Auto-renewal enabled. Your plan will renew automatically."
        : "Auto-renewal disabled. Your plan will cancel at the end of the current period.",
    });
  } catch (err) {
    console.error("toggleAutoRenewal error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to toggle auto-renewal" });
  }
};

module.exports = {
  getActivePlans,
  getCurrentSubscription,
  validateCoupon,
  createSetupIntent,
  listPaymentMethods,
  attachPaymentMethod,
  removePaymentMethod,
  setDefaultPaymentMethod,
  subscribeToPlan,
  activateSubscription,
  cancelSubscription,
  upgradePlan,
  previewUpgrade,
  getAgentQuota,
  previewAgentSeats,
  updateAgentSeats,
  getInvoices,
  handleStripeWebhook,
  getRetentionSettings,
  generateRetentionCoupon,
  getMyRetentionCoupon,
  toggleAutoRenewal,
};
