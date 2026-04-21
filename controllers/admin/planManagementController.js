const Plan = require("../../models/Plan");
const User = require("../../models/userModel");
const Subscription = require("../../models/Subscription");
const stripeService = require("../../services/stripeService");

// ─── Get All Plans (with subscriber counts) ───────────────────────────────────
const getAllPlans = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const plans = await Plan.find({ isDeleted: false })
      .sort({ order: 1, createdAt: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get subscriber counts per plan
    const planIds = plans.map((p) => p._id);
    const subscriberCounts = await Subscription.aggregate([
      { $match: { planId: { $in: planIds }, status: { $in: ["active", "trialing", "paused"] } } },
      { $group: { _id: "$planId", count: { $sum: 1 } } },
    ]);
    const countMap = {};
    subscriberCounts.forEach((s) => { countMap[s._id.toString()] = s.count; });

    const plansWithCount = plans.map((p) => ({
      ...p.toObject(),
      subscriberCount: countMap[p._id.toString()] || 0,
    }));

    const total = await Plan.countDocuments({ isDeleted: false });

    res.json({ success: true, plans: plansWithCount, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("getAllPlans error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch plans" });
  }
};

// ─── Create Plan ──────────────────────────────────────────────────────────────
const createPlan = async (req, res) => {
  try {
    const { name, description, tag, tagColor, isActive, features, commonFeatures, pricing, agentPrice, isEnterprise } = req.body;

    if (!name) return res.status(400).json({ success: false, message: "Plan name is required" });

    // Enterprise plans have no pricing — skip Stripe product/price creation
    const pricingResult = {};
    if (!isEnterprise) {
      const periods = ["monthly", "quarterly", "semiannual", "yearly"];
      const intervalConfig = {
        monthly:    { interval: "month", intervalCount: 1 },
        quarterly:  { interval: "month", intervalCount: 3 },
        semiannual: { interval: "month", intervalCount: 6 },
        yearly:     { interval: "year",  intervalCount: 1 },
      };

      for (const period of periods) {
        const tier = pricing?.[period];
        if (tier && tier.price > 0) {
          let stripeProductId = null;
          let stripePriceId = null;
          try {
            const product = await stripeService.createStripeProduct(
              `${name} - ${period.charAt(0).toUpperCase() + period.slice(1)}`,
              description
            );
            const cfg = intervalConfig[period];
            const price = await stripeService.createStripePrice(
              product.id,
              tier.price,
              cfg.interval,
              cfg.intervalCount
            );
            stripeProductId = product.id;
            stripePriceId = price.id;
          } catch (stripeErr) {
            console.error(`Stripe setup failed for ${period} (plan will save without Stripe IDs):`, stripeErr.message);
          }
          pricingResult[period] = {
            price: tier.price,
            discountPercent: tier.discountPercent || 0,
            stripeProductId,
            stripePriceId,
          };
        } else {
          pricingResult[period] = {
            price: tier?.price || 0,
            discountPercent: tier?.discountPercent || 0,
            stripeProductId: null,
            stripePriceId: null,
          };
        }
      }
    } else {
      // Enterprise: no pricing stored
      ["monthly", "quarterly", "semiannual", "yearly"].forEach((period) => {
        pricingResult[period] = { price: 0, discountPercent: 0, stripeProductId: null, stripePriceId: null };
      });
    }

    // Get highest order number
    const lastPlan = await Plan.findOne({ isDeleted: false }).sort({ order: -1 });
    const order = lastPlan ? lastPlan.order + 1 : 0;

    const plan = await Plan.create({
      name,
      description: description || "",
      tag: tag || "",
      tagColor: tagColor || "#7c3aed",
      isActive: isActive !== undefined ? isActive : true,
      features: features || [],
      commonFeatures: commonFeatures || [],
      pricing: pricingResult,
      agentPrice: agentPrice || 0,
      isEnterprise: isEnterprise || false,
      order,
    });

    res.status(201).json({ success: true, message: "Plan created successfully", plan });
  } catch (err) {
    console.error("createPlan error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to create plan" });
  }
};

// ─── Update Plan ──────────────────────────────────────────────────────────────
const updatePlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const { name, description, tag, tagColor, isActive, features, commonFeatures, pricing, agentPrice, isEnterprise } = req.body;

    const plan = await Plan.findOne({ _id: planId, isDeleted: false });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const periods = ["monthly", "quarterly", "semiannual", "yearly"];
    const intervalConfig = {
      monthly:    { interval: "month", intervalCount: 1 },
      quarterly:  { interval: "month", intervalCount: 3 },
      semiannual: { interval: "month", intervalCount: 6 },
      yearly:     { interval: "year",  intervalCount: 1 },
    };

    if (pricing) {
      for (const period of periods) {
        const newTier = pricing[period];
        if (!newTier) continue;
        const existingTier = plan.pricing[period];

        // If price set to 0 — disable this period
        if (newTier.price === 0) {
          plan.pricing[period].price = 0;
          plan.pricing[period].discountPercent = newTier.discountPercent ?? 0;
        // If price changed to a new non-zero value — create a new Stripe price
        } else if (newTier.price !== existingTier?.price) {
          let productId = existingTier?.stripeProductId;
          let stripePriceId = null;
          try {
            if (!productId) {
              const product = await stripeService.createStripeProduct(
                `${name || plan.name} - ${period.charAt(0).toUpperCase() + period.slice(1)}`,
                description || plan.description
              );
              productId = product.id;
            }
            if (existingTier?.stripePriceId) {
              await stripeService.deactivateStripePrice(existingTier.stripePriceId);
            }
            const cfg = intervalConfig[period];
            const newPrice = await stripeService.createStripePrice(productId, newTier.price, cfg.interval, cfg.intervalCount);
            stripePriceId = newPrice.id;
          } catch (stripeErr) {
            console.error(`Stripe update failed for ${period} (saving price without Stripe IDs):`, stripeErr.message);
            productId = existingTier?.stripeProductId || null;
          }
          plan.pricing[period] = {
            price: newTier.price,
            discountPercent: newTier.discountPercent ?? 0,
            stripeProductId: productId,
            stripePriceId,
          };
        } else {
          // Same price — only update discountPercent
          plan.pricing[period].discountPercent = newTier.discountPercent ?? plan.pricing[period].discountPercent;
        }
      }
    }

    if (name !== undefined) plan.name = name;
    if (description !== undefined) plan.description = description;
    if (tag !== undefined) plan.tag = tag;
    if (tagColor !== undefined) plan.tagColor = tagColor;
    if (isActive !== undefined) plan.isActive = isActive;
    if (features !== undefined) plan.features = features;
    if (commonFeatures !== undefined) plan.commonFeatures = commonFeatures;
    if (agentPrice !== undefined) plan.agentPrice = agentPrice;
    if (isEnterprise !== undefined) plan.isEnterprise = isEnterprise;

    plan.markModified("pricing");
    await plan.save();

    res.json({ success: true, message: "Plan updated successfully", plan });
  } catch (err) {
    console.error("updatePlan error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to update plan" });
  }
};

// ─── Delete Plan ──────────────────────────────────────────────────────────────
const deletePlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const plan = await Plan.findOne({ _id: planId, isDeleted: false });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const activeSubs = await Subscription.countDocuments({
      planId,
      status: { $in: ["active", "trialing"] },
    });
    if (activeSubs > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete plan with ${activeSubs} active subscriber(s). Deactivate it instead.`,
      });
    }

    plan.isDeleted = true;
    plan.deletedAt = new Date();
    plan.isActive = false;
    await plan.save();

    res.json({ success: true, message: "Plan deleted successfully" });
  } catch (err) {
    console.error("deletePlan error:", err);
    res.status(500).json({ success: false, message: "Failed to delete plan" });
  }
};

// ─── Toggle Plan Status ───────────────────────────────────────────────────────
const togglePlanStatus = async (req, res) => {
  try {
    const { planId } = req.params;
    const plan = await Plan.findOne({ _id: planId, isDeleted: false });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    plan.isActive = !plan.isActive;
    await plan.save();

    res.json({ success: true, message: `Plan ${plan.isActive ? "activated" : "deactivated"} successfully`, plan });
  } catch (err) {
    console.error("togglePlanStatus error:", err);
    res.status(500).json({ success: false, message: "Failed to toggle plan status" });
  }
};

// ─── Reorder Plans ────────────────────────────────────────────────────────────
const reorderPlans = async (req, res) => {
  try {
    const { orderedIds } = req.body; // Array of plan IDs in new order
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ success: false, message: "orderedIds must be an array" });
    }

    const bulkOps = orderedIds.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: index } } },
    }));
    await Plan.bulkWrite(bulkOps);

    res.json({ success: true, message: "Plans reordered successfully" });
  } catch (err) {
    console.error("reorderPlans error:", err);
    res.status(500).json({ success: false, message: "Failed to reorder plans" });
  }
};

// ─── Common Features (global for all plans) ───────────────────────────────────
const updateCommonFeatures = async (req, res) => {
  try {
    const { commonFeatures } = req.body; // Array of {text, order}
    if (!Array.isArray(commonFeatures)) {
      return res.status(400).json({ success: false, message: "commonFeatures must be an array" });
    }
    // Update all active plans with the same common features
    await Plan.updateMany({ isDeleted: false }, { $set: { commonFeatures } });
    res.json({ success: true, message: "Common features updated for all plans" });
  } catch (err) {
    console.error("updateCommonFeatures error:", err);
    res.status(500).json({ success: false, message: "Failed to update common features" });
  }
};

// ─── Pause User Subscription ──────────────────────────────────────────────────
const pauseUserSubscription = async (req, res) => {
  try {
    const { pauseDurationDays = 30 } = req.body;
    const userId = req.params.userId || req.body.userId;

    const subscription = await Subscription.findOne({
      userId,
      status: "active",
    });
    if (!subscription) {
      return res.status(404).json({ success: false, message: "No active subscription found for this user" });
    }

    // Calculate remaining days
    const now = new Date();
    const periodEnd = new Date(subscription.currentPeriodEnd);
    const msLeft = periodEnd - now;
    const remainingDays = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));

    // Pause on Stripe
    if (subscription.stripeSubscriptionId) {
      await stripeService.pauseSubscription(subscription.stripeSubscriptionId);
    }

    subscription.status = "paused";
    subscription.pausedAt = now;
    subscription.remainingDaysAtPause = remainingDays;
    subscription.pauseDurationDays = pauseDurationDays;
    await subscription.save();

    await User.findByIdAndUpdate(userId, { planStatus: "paused" });

    res.json({
      success: true,
      message: `Subscription paused. User has ${remainingDays} days remaining when resumed.`,
      subscription,
    });
  } catch (err) {
    console.error("pauseUserSubscription error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to pause subscription" });
  }
};

// ─── Resume User Subscription ─────────────────────────────────────────────────
const resumeUserSubscription = async (req, res) => {
  try {
    const userId = req.params.userId || req.body.userId;

    const subscription = await Subscription.findOne({ userId, status: "paused" });
    if (!subscription) {
      return res.status(404).json({ success: false, message: "No paused subscription found for this user" });
    }

    // New period end = now + remainingDays
    const now = new Date();
    const newPeriodEnd = new Date(now.getTime() + subscription.remainingDaysAtPause * 24 * 60 * 60 * 1000);

    // Resume on Stripe
    if (subscription.stripeSubscriptionId) {
      await stripeService.resumeSubscription(subscription.stripeSubscriptionId, newPeriodEnd);
    }

    subscription.status = "active";
    subscription.resumedAt = now;
    subscription.currentPeriodEnd = newPeriodEnd;
    subscription.pausedAt = null;
    await subscription.save();

    await User.findByIdAndUpdate(userId, { planStatus: "active" });

    res.json({
      success: true,
      message: `Subscription resumed. New expiry: ${newPeriodEnd.toDateString()}`,
      subscription,
    });
  } catch (err) {
    console.error("resumeUserSubscription error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to resume subscription" });
  }
};

// ─── Cancel User Subscription (superAdmin) ───────────────────────────────────
const cancelUserSubscription = async (req, res) => {
  try {
    const userId = req.params.userId || req.body.userId;

    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["active", "trialing", "paused"] },
    });
    if (!subscription) {
      return res.status(404).json({ success: false, message: "No active subscription found for this user" });
    }

    if (subscription.stripeSubscriptionId) {
      await stripeService.cancelSubscription(subscription.stripeSubscriptionId);
    }

    subscription.status = "cancelled";
    subscription.cancelledAt = new Date();
    subscription.cancelAtPeriodEnd = false;
    await subscription.save();

    await User.findByIdAndUpdate(userId, { planStatus: "cancelled" });

    res.json({ success: true, message: "Subscription cancelled successfully", subscription });
  } catch (err) {
    console.error("cancelUserSubscription error:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to cancel subscription" });
  }
};

// ─── Update Global Trial Period ───────────────────────────────────────────────
const getGlobalConfig = async (req, res) => {
  try {
    const admin = await User.findById(req.user._id).select("trialDurationDays emailReminderDays activeBillingPeriods").lean();
    res.json({
      success: true,
      defaultTrialDays: admin?.trialDurationDays ?? 7,
      defaultEmailReminderDays: admin?.emailReminderDays ?? [7, 3, 1],
      activePeriods: admin?.activeBillingPeriods?.length
        ? admin.activeBillingPeriods
        : ["monthly", "quarterly", "semiannual", "yearly"],
    });
  } catch (err) {
    console.error("getGlobalConfig error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch config" });
  }
};

// ─── Update Active Billing Periods ────────────────────────────────────────────
const updateActivePeriods = async (req, res) => {
  try {
    const { periods } = req.body;
    if (!Array.isArray(periods) || periods.length === 0) {
      return res.status(400).json({ success: false, message: "At least one billing period is required" });
    }
    const valid = ["monthly", "quarterly", "semiannual", "yearly"];
    const filtered = periods.filter((p) => valid.includes(p));
    if (filtered.length === 0) {
      return res.status(400).json({ success: false, message: "No valid periods provided" });
    }
    await User.findByIdAndUpdate(req.user._id, { activeBillingPeriods: filtered });
    res.json({ success: true, message: "Billing periods updated", activePeriods: filtered });
  } catch (err) {
    console.error("updateActivePeriods error:", err);
    res.status(500).json({ success: false, message: "Failed to update billing periods" });
  }
};

const updateGlobalTrialPeriod = async (req, res) => {
  try {
    const { durationDays } = req.body;
    if (!durationDays || durationDays < 1) {
      return res.status(400).json({ success: false, message: "durationDays must be >= 1" });
    }

    // Save as the global default on the superAdmin's own doc only
    // New company registrations will inherit this value; existing customers are not affected
    await User.findByIdAndUpdate(req.user._id, { trialDurationDays: durationDays });

    res.json({ success: true, message: `Global trial period set to ${durationDays} days` });
  } catch (err) {
    console.error("updateGlobalTrialPeriod error:", err);
    res.status(500).json({ success: false, message: "Failed to update global trial period" });
  }
};

// ─── Update Per-User Trial Period ─────────────────────────────────────────────
const updateUserTrialPeriod = async (req, res) => {
  try {
    const { userId } = req.params;
    const { durationDays } = req.body;
    if (!durationDays || durationDays < 1) {
      return res.status(400).json({ success: false, message: "durationDays must be >= 1" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.trialDurationDays = durationDays;

    // If still in trial, extend trialEndsAt
    if (user.planStatus === "trial" && user.trialStartedAt) {
      user.trialEndsAt = new Date(
        new Date(user.trialStartedAt).getTime() + durationDays * 24 * 60 * 60 * 1000
      );
    }
    await user.save();

    res.json({ success: true, message: `Trial period updated to ${durationDays} days for user`, user: { _id: user._id, trialDurationDays: user.trialDurationDays, trialEndsAt: user.trialEndsAt } });
  } catch (err) {
    console.error("updateUserTrialPeriod error:", err);
    res.status(500).json({ success: false, message: "Failed to update user trial period" });
  }
};

// ─── Update Email Reminder Schedule ──────────────────────────────────────────
const updateEmailReminderSchedule = async (req, res) => {
  try {
    const { userId, reminderDays, global: isGlobal } = req.body;
    // reminderDays: e.g. [7, 3, 1]

    if (!Array.isArray(reminderDays) || reminderDays.length === 0 || reminderDays.some((d) => typeof d !== "number" || isNaN(d) || d < 1)) {
      return res.status(400).json({ success: false, message: "reminderDays must be a non-empty array of positive numbers" });
    }

    if (isGlobal) {
      // Save as global default on the superAdmin's own doc
      await User.findByIdAndUpdate(req.user._id, { emailReminderDays: reminderDays });
      await User.updateMany({ role: "companyAdmin" }, { $set: { emailReminderDays: reminderDays, reminderEmailsSent: [] } });
      res.json({ success: true, message: "Global email reminder schedule updated" });
    } else {
      if (!userId) return res.status(400).json({ success: false, message: "userId required for per-user update" });
      await User.findByIdAndUpdate(userId, { emailReminderDays: reminderDays, reminderEmailsSent: [] });
      res.json({ success: true, message: "User email reminder schedule updated" });
    }
  } catch (err) {
    console.error("updateEmailReminderSchedule error:", err);
    res.status(500).json({ success: false, message: "Failed to update email reminder schedule" });
  }
};

// ─── Trigger Reminder Emails (for AWS Scheduler) ─────────────────────────────
const triggerReminderEmails = async (req, res) => {
  try {
    const { processExpiryReminders } = require("../../services/emailReminderService");
    const results = await processExpiryReminders();
    res.json({ success: true, message: "Reminder emails processed", results });
  } catch (err) {
    console.error("triggerReminderEmails error:", err);
    res.status(500).json({ success: false, message: "Failed to process reminder emails" });
  }
};

// ─── Pause / Resume User Access (works for trial AND paid plans) ───────────────
const pauseUserAccess = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.accessPausedByAdmin = true;
    user.accessPausedAt = new Date();
    await user.save();

    res.json({ success: true, message: "User access paused" });
  } catch (err) {
    console.error("pauseUserAccess error:", err);
    res.status(500).json({ success: false, message: "Failed to pause user access" });
  }
};

const resumeUserAccess = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.accessPausedByAdmin = false;
    user.accessPausedAt = null;
    await user.save();

    res.json({ success: true, message: "User access resumed" });
  } catch (err) {
    console.error("resumeUserAccess error:", err);
    res.status(500).json({ success: false, message: "Failed to resume user access" });
  }
};

// ─── Search Users (for assign plan modal) ────────────────────────────────────
const searchUsers = async (req, res) => {
  try {
    const { q = "" } = req.query;
    const regex = new RegExp(q.trim(), "i");
    const users = await User.find({
      role: "companyAdmin",
      isDeleted: { $ne: true },
      $or: [{ email: regex }, { firstname: regex }, { lastname: regex }],
    })
      .select("_id firstname lastname email planStatus")
      .limit(20)
      .lean();
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: "Search failed" });
  }
};

// ─── Assign Plan to User (admin override, no Stripe) ─────────────────────────
const assignPlanToUser = async (req, res) => {
  try {
    const { userId, planId, billingPeriod } = req.body;
    if (!userId || !planId || !billingPeriod) {
      return res.status(400).json({ success: false, message: "userId, planId and billingPeriod are required" });
    }

    const [user, plan] = await Promise.all([
      User.findById(userId),
      Plan.findById(planId),
    ]);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    const now = new Date();
    const months = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 }[billingPeriod] || 1;
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + months);

    // Cancel any existing active subscription
    await Subscription.updateMany(
      { userId, status: { $in: ["active", "trialing", "paused"] } },
      { $set: { status: "cancelled", cancelledAt: now } }
    );

    // Create new admin-assigned subscription (no Stripe IDs)
    const sub = await Subscription.create({
      userId,
      planId,
      billingPeriod,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    });

    // Update user's plan status
    user.planStatus = "active";
    user.currentSubscriptionId = sub._id;
    await user.save();

    res.json({ success: true, message: `Plan assigned to ${user.email}`, subscription: sub });
  } catch (err) {
    console.error("assignPlanToUser error:", err);
    res.status(500).json({ success: false, message: "Failed to assign plan" });
  }
};

module.exports = {
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
  togglePlanStatus,
  reorderPlans,
  assignPlanToUser,
  searchUsers,
  updateCommonFeatures,
  pauseUserSubscription,
  resumeUserSubscription,
  cancelUserSubscription,
  getGlobalConfig,
  updateGlobalTrialPeriod,
  updateUserTrialPeriod,
  updateEmailReminderSchedule,
  triggerReminderEmails,
  pauseUserAccess,
  resumeUserAccess,
  updateActivePeriods,
  assignPlanToUser,
  searchUsers,
};
