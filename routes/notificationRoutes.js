const express = require("express");
const router = express.Router();
const checkAccountStatus = require("../middlewares/checkAccountStatus");
const checkRole = require("../middlewares/roleCheck");
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
} = require("../controllers/notificationController");

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

// SuperAdmin only: create notifications
router.post("/", checkRole(["superadmin"]), createNotification);

module.exports = router;
