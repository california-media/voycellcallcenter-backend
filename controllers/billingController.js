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

    res.json({
      success: true,
      subscription: subscription || null,
      planStatus: user.planStatus,
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
const subscribeToPlan = async (req, res) => {
  try {
    const { planId, billingPeriod, paymentMethodId, couponCode } = req.body;

    if (!planId || !billingPeriod || !paymentMethodId) {
      return res.status(400).json({ success: false, message: "planId, billingPeriod, and paymentMethodId are required" });
    }
    if (!["monthly", "quarterly", "yearly"].includes(billingPeriod)) {
      return res.status(400).json({ success: false, message: "Invalid billing period" });
    }

    const plan = await Plan.findOne({ _id: planId, isActive: true, isDeleted: false });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const pricingTier = plan.pricing[billingPeriod];
    if (!pricingTier?.stripePriceId) {
      return res.status(400).json({ success: false, message: "This plan does not support the selected billing period" });
    }

    const user = await User.findById(req.user._id);

    // Check for existing active/trialing subscription
    const existingSub = await Subscription.findOne({
      userId: user._id,
      status: { $in: ["active", "trialing", "paused"] },
    });
    if (existingSub) {
      return res.status(400).json({ success: false, message: "You already have an active subscription. Please cancel or upgrade it." });
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

    // Trial end date (for trialing users upgrading mid-trial)
    let trialEnd = null;
    if (user.planStatus === "trial" && user.trialEndsAt && new Date(user.trialEndsAt) > new Date()) {
      trialEnd = user.trialEndsAt;
    }

    // Create Stripe subscription
    const stripeSub = await stripeService.createSubscription({
      stripeCustomerId: customer.id,
      stripePriceId: pricingTier.stripePriceId,
      paymentMethodId,
      trialEnd,
      couponId,
    });

    // Save subscription in DB
    const now = new Date();
    const periodStart = stripeSub.current_period_start
      ? new Date(stripeSub.current_period_start * 1000) : now;
    const periodEnd = stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000) : null;

    const subscription = await Subscription.create({
      userId: user._id,
      planId: plan._id,
      billingPeriod,
      status: stripeSub.status === "trialing" ? "trialing" : "active",
      stripeSubscriptionId: stripeSub.id,
      stripeCustomerId: customer.id,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialStart: stripeSub.trial_start ? new Date(stripeSub.trial_start * 1000) : null,
      trialEnd: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
      couponCode: appliedCouponCode,
      stripeCouponId: couponId,
    });

    // Update user plan status
    await User.findByIdAndUpdate(user._id, {
      planStatus: "active",
      reminderEmailsSent: [],
    });

    res.status(201).json({
      success: true,
      message: "Subscription created successfully",
      subscription,
      clientSecret: stripeSub.latest_invoice?.payment_intent?.client_secret || null,
    });
  } catch (err) {
    console.error("subscribeToPlan error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to create subscription" });
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
      await stripeService.cancelSubscription(subscription.stripeSubscriptionId, true); // cancel at period end
    }

    subscription.cancelAtPeriodEnd = true;
    subscription.cancelledAt = new Date();
    await subscription.save();

    await User.findByIdAndUpdate(userId, { planStatus: "cancelled" });

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
    if (!pricingTier?.stripePriceId) {
      return res.status(400).json({ success: false, message: "Plan does not support the selected billing period" });
    }

    const subscription = await Subscription.findOne({
      userId: req.user._id,
      status: { $in: ["active", "trialing"] },
    });
    if (!subscription) return res.status(404).json({ success: false, message: "No active subscription found to upgrade" });

    if (subscription.stripeSubscriptionId) {
      await stripeService.updateSubscriptionPlan(subscription.stripeSubscriptionId, pricingTier.stripePriceId);
    }

    subscription.planId = plan._id;
    subscription.billingPeriod = billingPeriod;
    await subscription.save();

    res.json({ success: true, message: "Subscription upgraded successfully", subscription });
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
      await Invoice.findOneAndUpdate(
        { stripeInvoiceId: si.id },
        {
          userId,
          subscriptionId: subscription?._id || null,
          planId: subscription?.planId || null,
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
          billingPeriodStart: si.period_start ? new Date(si.period_start * 1000) : null,
          billingPeriodEnd: si.period_end ? new Date(si.period_end * 1000) : null,
          stripeCreatedAt: si.created ? new Date(si.created * 1000) : null,
        },
        { upsert: true, new: true }
      );
    }
  } catch (err) {
    console.error("syncStripeInvoices error:", err.message);
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

    // Billing summary
    const summary = await Invoice.aggregate([
      { $match: { userId: userId } },
      { $group: { _id: null, totalPaid: { $sum: "$amountPaid" }, totalBills: { $sum: 1 } } },
    ]);

    const { totalPaid = 0, totalBills = 0 } = summary[0] || {};

    res.json({
      success: true,
      invoices,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
      summary: { totalPaid, totalBills },
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
            billingPeriodStart: stripeInvoice.period_start ? new Date(stripeInvoice.period_start * 1000) : null,
            billingPeriodEnd: stripeInvoice.period_end ? new Date(stripeInvoice.period_end * 1000) : null,
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
  cancelSubscription,
  upgradePlan,
  getInvoices,
  handleStripeWebhook,
};
