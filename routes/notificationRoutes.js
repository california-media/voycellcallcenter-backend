const express = require("express");
const router  = express.Router();
const multer  = require("multer");
const checkAccountStatus = require("../middlewares/checkAccountStatus");
const checkRole = require("../middlewares/roleCheck");

// multer — store attachments in memory (max 10 MB per file, max 5 files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  markBulkRead,
  deleteNotification,
  deleteBulk,
  clearAll,
  createNotification,
  getSentNotifications,
  getNotificationStats,
  sendEmailNotification,
  getEmailLogs,
  getEmailLogById,
  getEmailLogRecipients,
  syncEmailLogStats,
} = require("../controllers/notificationController");

const {
  listSenders,
  addSender,
  setDefault,
  deleteSender,
} = require("../controllers/emailSenderController");

const {
  getBatchConfig,
  updateBatchConfig,
  listBatchJobs,
  getBatchJobDetail,
  cancelBatchJob,
  getSendCaps,
  cleanupSesEvents,
} = require("../controllers/emailBatchConfigController");

const { triggerBatchJob } = require("../controllers/emailBatchTriggerController");

// All routes require auth + active account (added in index.js)
router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.get("/sent", checkRole(["superadmin"]), getSentNotifications);
router.get("/sent/:logId/stats", checkRole(["superadmin"]), getNotificationStats);
router.patch("/:id/read", markAsRead);
router.patch("/mark-all-read", markAllAsRead);
router.patch("/mark-bulk-read", markBulkRead);
router.delete("/clear-all", clearAll);
router.delete("/bulk", deleteBulk);
router.delete("/:id", deleteNotification);

// SuperAdmin only: create notifications & email logs
router.post("/", checkRole(["superadmin"]), createNotification);
router.post("/send-email",     checkRole(["superadmin"]), upload.array("attachments", 5), sendEmailNotification);
router.get("/email-logs", checkRole(["superadmin"]), getEmailLogs);
router.get("/email-logs/:id/sync-stats", checkRole(["superadmin"]), syncEmailLogStats);
router.get("/email-logs/:id/recipients", checkRole(["superadmin"]), getEmailLogRecipients);
router.get("/email-logs/:id", checkRole(["superadmin"]), getEmailLogById);

// SuperAdmin only: manage "From" email sender addresses
router.get("/email-senders",                checkRole(["superadmin"]), listSenders);
router.post("/email-senders",               checkRole(["superadmin"]), addSender);
router.put("/email-senders/:id/default",    checkRole(["superadmin"]), setDefault);
router.delete("/email-senders/:id",         checkRole(["superadmin"]), deleteSender);

// SuperAdmin only: batch sending config + job management
router.get("/batch-config",                 checkRole(["superadmin"]), getBatchConfig);
router.put("/batch-config",                 checkRole(["superadmin"]), updateBatchConfig);
router.get("/batch-jobs",                   checkRole(["superadmin"]), listBatchJobs);
router.get("/batch-jobs/:jobId",            checkRole(["superadmin"]), getBatchJobDetail);
router.post("/batch-jobs/:jobId/trigger",   checkRole(["superadmin"]), triggerBatchJob);
router.delete("/batch-jobs/:jobId/cancel",  checkRole(["superadmin"]), cancelBatchJob);
router.get("/send-caps",                    checkRole(["superadmin"]), getSendCaps);
router.delete("/ses-events/cleanup",        checkRole(["superadmin"]), cleanupSesEvents);

module.exports = router;
