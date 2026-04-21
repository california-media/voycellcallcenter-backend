const mongoose = require("mongoose");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const Invoice = require("../models/Invoice");
const Coupon = require("../models/Coupon");
const User = require("../models/userModel");
const stripeService = require("../services/stripeService");

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
const upgradePlan = async (req, res) => {
  try {
    const { planId, billingPeriod } = req.body;
    if (!planId || !billingPeriod) {
      return res.status(400).json({ success: false, message: "planId and billingPeriod are required" });
    }

    const plan = await Plan.findOne({ _id: planId, isActive: true, isDeleted: false });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const pricingTier = plan.pricing[billingPeriod];

    const subscription = await Subscription.findOne({
      userId: req.user._id,
      status: { $in: ["active", "trialing"] },
    });
    if (!subscription) return res.status(404).json({ success: false, message: "No active subscription found to upgrade" });

    // Only call Stripe if this subscription was created via Stripe AND the plan has a Stripe price
    if (subscription.stripeSubscriptionId && pricingTier?.stripePriceId) {
      const updatedStripeSub = await stripeService.updateSubscriptionPlan(
        subscription.stripeSubscriptionId,
        pricingTier.stripePriceId
      );

      // Save the proration/upgrade invoice immediately so it gets the NEW plan's ID,
      // not the old one. Without this, syncStripeInvoices would stamp it with whatever
      // plan is current at next getInvoices call — which is correct after this save,
      // but we also want the old invoices untouched (handled by $setOnInsert in sync).
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
              planId: plan._id,              // ← NEW plan, written immediately
              stripeInvoiceId: latestInvoice.id,
              stripeCustomerId: subscription.stripeCustomerId,
              stripeChargeId: latestInvoice.charge || null,
              invoiceNumber: latestInvoice.number || null,
              amount: latestInvoice.amount_due,
              amountPaid: latestInvoice.amount_paid,
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
    await subscription.save();

    res.json({ success: true, message: "Plan changed successfully", subscription });
  } catch (err) {
    console.error("upgradePlan error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to upgrade subscription" });
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

      await Invoice.findOneAndUpdate(
        { stripeInvoiceId: si.id },
        {
          // Always update these — they can change (payment status, PDF link, etc.)
          $set: {
            userId,
            subscriptionId: subscription?._id || null,
            stripeInvoiceId: si.id,
            stripeCustomerId,
            stripeChargeId: si.charge || null,
            invoiceNumber: si.number || null,
            amount: si.amount_due,
            amountPaid: si.amount_paid,
            currency: si.currency,
            status: si.status,
            invoicePdf: si.invoice_pdf || null,
            hostedInvoiceUrl: si.hosted_invoice_url || null,
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
            stripeCreatedAt: si.created ? new Date(si.created * 1000) : null,
          },
          // planId is written ONLY when creating a new invoice document.
          // Never overwrite it on existing records — that would stamp the CURRENT
          // plan onto historical invoices after an upgrade.
          $setOnInsert: {
            planId: subscription?.planId || null,
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

        // Upsert invoice
        await Invoice.findOneAndUpdate(
          { stripeInvoiceId: stripeInvoice.id },
          {
            userId: user._id,
            subscriptionId: sub?._id || null,
            planId: sub?.planId || null,
            stripeInvoiceId: stripeInvoice.id,
            stripeCustomerId: customerId,
            stripeChargeId: stripeInvoice.charge || null,
            invoiceNumber: stripeInvoice.number || null,
            amount: stripeInvoice.amount_due,
            amountPaid: stripeInvoice.amount_paid,
            currency: stripeInvoice.currency,
            status: stripeInvoice.status,
            invoicePdf: stripeInvoice.invoice_pdf || null,
            hostedInvoiceUrl: stripeInvoice.hosted_invoice_url || null,
            billingPeriodStart: wPeriodStart,
            billingPeriodEnd: wPeriodEnd,
            stripeCreatedAt: stripeInvoice.created ? new Date(stripeInvoice.created * 1000) : null,
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
  getAgentQuota,
  previewAgentSeats,
  updateAgentSeats,
  getInvoices,
  handleStripeWebhook,
};
