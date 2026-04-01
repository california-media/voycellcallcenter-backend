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
  updateGlobalTrialPeriod,
  updateUserTrialPeriod,
  updateEmailReminderSchedule,
  triggerReminderEmails,
} = require("../../controllers/admin/planManagementController");

// Plans CRUD
router.get("/", getAllPlans);
router.post("/", createPlan);
router.put("/reorder", reorderPlans);
router.put("/common-features", updateCommonFeatures);
router.put("/:planId", updatePlan);
router.delete("/:planId", deletePlan);
router.put("/:planId/toggle", togglePlanStatus);

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

module.exports = router;
