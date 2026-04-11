const express = require("express");
const router = express.Router();
const {
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
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
} = require("../../controllers/admin/planManagementController");

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

// Trial period management
router.put("/trial/global", updateGlobalTrialPeriod);
router.put("/trial/user/:userId", updateUserTrialPeriod);

// Email reminder schedule
router.put("/email-reminders", updateEmailReminderSchedule);
router.post("/email-reminders/trigger", triggerReminderEmails);

// Admin-controlled access pause (works for trial and paid plans)
router.post("/access/pause", pauseUserAccess);
router.post("/access/resume", resumeUserAccess);

// Wildcard plan routes — must come AFTER all specific PUT routes
router.put("/:planId", updatePlan);
router.delete("/:planId", deletePlan);
router.put("/:planId/toggle", togglePlanStatus);

module.exports = router;
