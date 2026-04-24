const express = require("express");
const router = express.Router();
const {
  getAllPlans,
  createPlan,
  updatePlan,
  togglePlanStatus,
  reorderPlans,
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
} = require("../../controllers/admin/planManagementController");

const Plan         = require("../../models/Plan");
const Subscription = require("../../models/Subscription");
const User         = require("../../models/userModel");

// Inline delete handler — cancels active subscriptions then soft-deletes the plan
const deletePlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const plan = await Plan.findOne({ _id: planId, isDeleted: false });
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });

    // Cancel any active subscriptions linked to this plan
    const subs = await Subscription.find({ planId, status: { $in: ["active", "trialing"] } }).select("userId").lean();
    if (subs.length > 0) {
      await Subscription.updateMany(
        { planId, status: { $in: ["active", "trialing"] } },
        { $set: { status: "cancelled", cancelledAt: new Date() } }
      );
      const userIds = subs.map((s) => s.userId);
      await User.updateMany({ _id: { $in: userIds } }, { $set: { planStatus: "cancelled" } });
    }

    plan.isDeleted = true;
    plan.deletedAt = new Date();
    plan.isActive  = false;
    await plan.save();

    return res.json({ success: true, message: "Plan deleted successfully" });
  } catch (err) {
    console.error("deletePlan error:", err);
    return res.status(500).json({ success: false, message: "Failed to delete plan" });
  }
};

// Global config
router.get("/config", getGlobalConfig);

// Plans CRUD
router.get("/", getAllPlans);
router.post("/", createPlan);
router.put("/reorder", reorderPlans);
router.put("/common-features", updateCommonFeatures);

// Subscription management (superAdmin controls)
router.post("/subscription/pause", pauseUserSubscription);
router.post("/subscription/resume", resumeUserSubscription);
router.put("/subscription/pause/:userId", pauseUserSubscription);
router.put("/subscription/resume/:userId", resumeUserSubscription);
router.post("/subscription/cancel", cancelUserSubscription);

// Billing period management
router.put("/billing-periods", updateActivePeriods);

// Trial period management
router.put("/trial/global", updateGlobalTrialPeriod);
router.put("/trial/user/:userId", updateUserTrialPeriod);

// Email reminder schedule
router.put("/email-reminders", updateEmailReminderSchedule);
router.post("/email-reminders/trigger", triggerReminderEmails);

// Admin-controlled access pause (works for trial and paid plans)
router.post("/access/pause", pauseUserAccess);
router.post("/access/resume", resumeUserAccess);

// Assign plan to user (admin override)
router.get("/users/search", searchUsers);
router.post("/assign-user", assignPlanToUser);

// Wildcard plan routes — must come AFTER all specific PUT routes
router.put("/:planId", updatePlan);
router.delete("/:planId", deletePlan);
router.put("/:planId/toggle", togglePlanStatus);

module.exports = router;
