const Notification = require("../models/Notification");
const NotificationLog = require("../models/NotificationLog");
const User = require("../models/userModel");
const { sendAdminBroadcastEmail } = require("../utils/emailUtils");

// ─── GET /notifications  (infinite scroll, 20 per page) ─────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    const query = { userId };
    if (unreadOnly === "true") query.isRead = false;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ userId, isRead: false }),
    ]);

    return res.json({
      status: "success",
      notifications,
      total,
      unreadCount,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      hasMore: skip + notifications.length < total,
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── GET /notifications/unread-count ────────────────────────────────────────
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user._id, isRead: false });
    return res.json({ status: "success", unreadCount: count });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── PATCH /notifications/:id/read  (mark single as read) ───────────────────
exports.markAsRead = async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isRead: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ status: "error", message: "Notification not found" });
    return res.json({ status: "success", notification: notif });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── PATCH /notifications/mark-all-read ─────────────────────────────────────
exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
    return res.json({ status: "success", message: "All notifications marked as read" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── PATCH /notifications/mark-bulk-read  (bulk by ids) ─────────────────────
exports.markBulkRead = async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!ids.length) return res.status(400).json({ status: "error", message: "ids required" });
    await Notification.updateMany({ _id: { $in: ids }, userId: req.user._id }, { isRead: true });
    return res.json({ status: "success" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── DELETE /notifications/:id ───────────────────────────────────────────────
exports.deleteNotification = async (req, res) => {
  try {
    const notif = await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!notif) return res.status(404).json({ status: "error", message: "Notification not found" });
    return res.json({ status: "success", message: "Notification deleted" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── DELETE /notifications/bulk  (bulk delete by ids) ───────────────────────
exports.deleteBulk = async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!ids.length) return res.status(400).json({ status: "error", message: "ids required" });
    await Notification.deleteMany({ _id: { $in: ids }, userId: req.user._id });
    return res.json({ status: "success" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── DELETE /notifications/clear-all ────────────────────────────────────────
exports.clearAll = async (req, res) => {
  try {
    await Notification.deleteMany({ userId: req.user._id });
    return res.json({ status: "success", message: "All notifications cleared" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── POST /notifications  (superAdmin only) ──────────────────────────────────
// target options:
//   "companies"  → all companyAdmin accounts only
//   "all"        → all companyAdmins + all agents
//   "specific"   → selected companyAdmins only (targetCompanyIds: string[])
exports.createNotification = async (req, res) => {
  try {
    const { title, description, body, attachments, category, target = "all", targetCompanyIds = [] } = req.body;

    if (!title) return res.status(400).json({ status: "error", message: "title is required" });

    let userIds = [];
    let logTargetCompanyIds = [];
    let logTargetCompanyNames = [];

    if (target === "specific") {
      if (!targetCompanyIds.length) return res.status(400).json({ status: "error", message: "targetCompanyIds is required for specific target" });
      // Only send to selected companyAdmins, not their agents
      const admins = await User.find({ _id: { $in: targetCompanyIds }, role: "companyAdmin" }).select("_id userInfo.companyName firstname lastname");
      userIds = admins.map((a) => a._id.toString());
      logTargetCompanyIds = admins.map((a) => a._id);
      logTargetCompanyNames = admins.map((a) => a.userInfo?.companyName || [a.firstname, a.lastname].filter(Boolean).join(" ") || a._id.toString());
    } else if (target === "companies") {
      const admins = await User.find({ role: "companyAdmin" }).select("_id");
      userIds = admins.map((u) => u._id.toString());
    } else {
      // "all" — companyAdmins + agents
      const allUsers = await User.find({ role: { $in: ["companyAdmin", "user"] } }).select("_id");
      userIds = allUsers.map((u) => u._id.toString());
    }

    if (!userIds.length) return res.status(400).json({ status: "error", message: "No users found for the selected target" });

    // Create log entry first to get its _id
    const log = await NotificationLog.create({
      title,
      description: description || "",
      body: body || "",
      target,
      targetCompanyIds: logTargetCompanyIds,
      targetCompanyNames: logTargetCompanyNames,
      recipientCount: userIds.length,
      createdBy: req.user._id,
    });

    const docs = userIds.map((uid) => ({
      userId: uid,
      companyId: target === "specific" && logTargetCompanyIds.length === 1 ? logTargetCompanyIds[0] : null,
      title,
      description: description || "",
      body: body || "",
      attachments: attachments || [],
      category: category || "general",
      createdBy: req.user._id,
      logId: log._id,
    }));

    await Notification.insertMany(docs);

    return res.json({ status: "success", message: `Notification sent to ${docs.length} user(s)` });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── GET /notifications/sent  (superAdmin — view sent history) ───────────────
exports.getSentNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      NotificationLog.find({ createdBy: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      NotificationLog.countDocuments({ createdBy: req.user._id }),
    ]);

    return res.json({
      status: "success",
      logs,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── GET /notifications/sent/:logId/stats  (superAdmin — read stats for one send) ─
exports.getNotificationStats = async (req, res) => {
  try {
    const log = await NotificationLog.findOne({ _id: req.params.logId, createdBy: req.user._id }).lean();
    if (!log) return res.status(404).json({ status: "error", message: "Notification log not found" });

    // Aggregate read/unread per recipient, join with user info
    const recipients = await Notification.find({ logId: req.params.logId })
      .populate("userId", "firstname lastname email userInfo.companyName role")
      .select("userId isRead createdAt")
      .lean();

    const readCount = recipients.filter((r) => r.isRead).length;
    const unreadCount = recipients.length - readCount;

    // Build hourly read timeline (for the chart) — group by hour from createdAt
    // We need readAt time but we only have isRead boolean. Instead we return
    // a simple summary plus the full recipient list.
    return res.json({
      status: "success",
      log,
      readCount,
      unreadCount,
      recipients: recipients.map((r) => ({
        _id: r.userId?._id,
        name: [r.userId?.firstname, r.userId?.lastname].filter(Boolean).join(" ") || r.userId?.email,
        email: r.userId?.email,
        companyName: r.userId?.userInfo?.companyName || "",
        role: r.userId?.role,
        isRead: r.isRead,
      })),
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── POST /notifications/send-email  (superAdmin — broadcast email) ──────────
// target: "all" | "companies" | "specific" (targetCompanyIds: [])
exports.sendEmailNotification = async (req, res) => {
  try {
    const { subject, title, body, target = "all", targetCompanyIds = [] } = req.body;

    if (!subject || !body) return res.status(400).json({ status: "error", message: "subject and body are required" });

    let users = [];

    if (target === "specific") {
      if (!targetCompanyIds.length) return res.status(400).json({ status: "error", message: "targetCompanyIds required for specific target" });
      users = await User.find({ _id: { $in: targetCompanyIds }, role: "companyAdmin" }).select("email firstname lastname");
    } else if (target === "companies") {
      users = await User.find({ role: "companyAdmin" }).select("email firstname lastname");
    } else {
      users = await User.find({ role: { $in: ["companyAdmin", "user"] } }).select("email firstname lastname");
    }

    if (!users.length) return res.status(400).json({ status: "error", message: "No users found" });

    // Send in parallel (fire-and-forget per recipient)
    await Promise.allSettled(
      users.map((u) =>
        sendAdminBroadcastEmail({ to: u.email, subject, title, body })
      )
    );

    return res.json({ status: "success", message: `Email sent to ${users.length} user(s)` });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};
