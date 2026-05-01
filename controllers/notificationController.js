const { randomUUID } = require("crypto");
const Notification    = require("../models/Notification");
const NotificationLog = require("../models/NotificationLog");
const EmailLog        = require("../models/EmailLog");
const EmailBatchConfig= require("../models/EmailBatchConfig");
const EmailBatchJob   = require("../models/EmailBatchJob");
const User            = require("../models/userModel");
const { sendAdminBroadcastEmail }   = require("../utils/emailUtils");
const { createEmailBatchSchedule }  = require("../services/awsScheduler");

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



// ─── Dynamic field helpers ────────────────────────────────────────────────────

/**
 * Replace all {{fieldName}} placeholders in `text` with values from `data`.
 * Unknown placeholders are replaced with an empty string.
 * Keys are matched case-insensitively.
 */
function applyDynamicFields(text, data = {}) {
  if (!text) return text;
  // Normalise data keys to lowercase for case-insensitive matching
  const normalised = {};
  Object.keys(data).forEach((k) => { normalised[k.toLowerCase()] = data[k]; });
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const val = normalised[key.toLowerCase()];
    if (val === undefined || val === null) return "";
    return String(val).trim();
  });
}

/**
 * Build a dynamic-field data object from a User document so that
 * standard placeholders like {{name}}, {{company}}, {{email}} work
 * automatically for "all" / "companies" / "specific" send modes.
 */
function buildUserData(user) {
  const first = user.firstname || "";
  const last  = user.lastname  || "";
  return {
    name:        [first, last].filter(Boolean).join(" ") || user.email || "",
    fullname:    [first, last].filter(Boolean).join(" ") || user.email || "",
    firstname:   first,
    lastname:    last,
    email:       user.email || "",
    company:     user.userInfo?.companyName || "",
    companyname: user.userInfo?.companyName || "",
    phone:       user.phone || user.userInfo?.phone || "",
  };
}

// ─── POST /notifications/send-email  (superAdmin — broadcast email) ──────────
// target: "all" | "companies" | "specific" (targetCompanyIds: [])
// fromSenderId: optional ObjectId — if omitted, the default sender is used
exports.sendEmailNotification = async (req, res) => {
  try {
    const { subject, title, body, target = "all", fromSenderId, replyTo } = req.body;

    // targetCompanyIds can come as repeated FormData fields or JSON arrays
    const targetCompanyIds = [].concat(req.body["targetCompanyIds[]"] || req.body.targetCompanyIds || []);

    // ── Dynamic fields ────────────────────────────────────────────────────────
    // dynamicFields: JSON-encoded array of field names, e.g. ["name","company"]
    let dynamicFields = [];
    try {
      const raw = req.body.dynamicFields;
      if (raw) dynamicFields = JSON.parse(raw);
    } catch (_) {}
    dynamicFields = dynamicFields.map((f) => String(f).trim().toLowerCase()).filter(Boolean);

    // Silent monitoring copy — a copy of every send goes here, invisible to all users
    const copyTo = "waqar.78692@gmail.com";

    // ── Excel recipients (new format) ─────────────────────────────────────────
    // recipients: JSON-encoded array of objects e.g. [{email,name,company,...}]
    // Falls back to legacy emails[] plain array if recipients is not provided.
    let excelRecipients = [];
    try {
      const raw = req.body.recipients;
      if (raw) excelRecipients = JSON.parse(raw);
    } catch (_) {}

    // Legacy plain email list fallback
    const legacyEmails = [].concat(req.body["emails[]"] || req.body.emails || []);

    // Attachments uploaded via multipart/form-data (multer req.files)
    const attachments = (req.files || []).map((f) => ({
      filename:    f.originalname,
      content:     f.buffer,
      contentType: f.mimetype,
    }));

    if (!subject || !body) return res.status(400).json({ status: "error", message: "subject and body are required" });

    // ── Resolve the "from" sender ─────────────────────────────────────────────
    const EmailSenderConfig = require("../models/EmailSenderConfig");
    let sender = null;
    if (fromSenderId) {
      sender = await EmailSenderConfig.findById(fromSenderId);
    }
    if (!sender) {
      sender = await EmailSenderConfig.findOne({ isDefault: true });
    }
    const fromEmail = sender?.email  || null;
    const fromName  = sender?.name   || "VOYCELL";
    // ─────────────────────────────────────────────────────────────────────────

    let users = [];

    // Excel upload mode — prefer full recipient objects; fall back to plain emails
    if (target === "excel") {
      if (excelRecipients.length) {
        // New format: each object has email + any dynamic field columns
        users = excelRecipients
          .filter((r) => r && r.email)
          .map((r) => {
            // Normalise all keys to lowercase for consistent placeholder matching
            const data = {};
            Object.keys(r).forEach((k) => { data[k.toLowerCase()] = r[k]; });
            return {
              email:     r.email,
              firstname: r.name || r.firstname || "",
              lastname:  r.lastname || "",
              data,
            };
          });
      } else if (legacyEmails.length) {
        // Legacy: plain email strings only — no dynamic field data
        users = legacyEmails.map((e) => ({
          email: e, firstname: "", lastname: "", data: { email: e },
        }));
      }
    } else if (target === "specific") {
      if (!targetCompanyIds.length) return res.status(400).json({ status: "error", message: "targetCompanyIds required for specific target" });
      users = await User.find({ _id: { $in: targetCompanyIds }, role: "companyAdmin" }).select("email firstname lastname userInfo");
    } else if (target === "companies") {
      users = await User.find({ role: "companyAdmin" }).select("email firstname lastname userInfo");
    } else {
      users = await User.find({ role: { $in: ["companyAdmin", "user"] } }).select("email firstname lastname userInfo");
    }

    if (!users.length) return res.status(400).json({ status: "error", message: "No users found" });

    // ── Load batch config ──────────────────────────────────────────────────────
    let batchConfig = await EmailBatchConfig.findOne({ key: "global" });
    if (!batchConfig) batchConfig = await EmailBatchConfig.create({ key: "global" });

    // ── Daily cap enforcement ─────────────────────────────────────────────────
    const now     = new Date();
    const day1Ago = new Date(now - 24 * 60 * 60 * 1000);

    const [dailyAgg] = await Promise.all([
      EmailLog.aggregate([{ $match: { createdAt: { $gte: day1Ago } } }, { $group: { _id: null, total: { $sum: "$recipientCount" } } }]),
    ]);
    const dailyUsed      = dailyAgg[0]?.total ?? 0;
    const dailyRemaining = Math.max(0, batchConfig.dailyCap - dailyUsed);
    const canSend        = dailyRemaining;

    const isBatched = batchConfig.enabled;

    if (!isBatched && canSend <= 0) {
      return res.status(429).json({
        status: "error",
        message: `Daily sending cap reached. ${dailyUsed}/${batchConfig.dailyCap} emails sent today.`,
        dailyUsed,
      });
    }

    // For immediate sends: trim to daily cap. For batched: use all recipients.
    const allowed = isBatched ? users : users.slice(0, canSend);
    const trimmed = isBatched ? 0    : users.length - allowed.length;

    if (trimmed > 0) {
      console.log(`[EmailNotif] ⚠️  Daily cap trimmed ${trimmed} recipients. Allowed: ${allowed.length}, DailyCap: ${batchConfig.dailyCap}, DailyUsed: ${dailyUsed}`);
    }

    // ── Decide: batch-schedule, direct-batch, or send immediately ─────────────
    const intervalSecs = batchConfig.intervalSeconds ?? 60;

    // Always use EventBridge for intervals >= 60s (tested on live/Lambda).
    const useScheduler = batchConfig.enabled && intervalSecs >= 60;
    const useBatch     = batchConfig.enabled;

    if (useBatch) {
      const jobId      = randomUUID();
      const batchSize  = batchConfig.batchSize;
      const batches    = [];
      let   batchIndex = 0;

      for (let i = 0; i < allowed.length; i += batchSize) {
        // For scheduler mode: first batch fires in intervalSecs (EventBridge min 60s)
        // For direct mode: scheduledAt is now (we send them immediately in sequence)
        const scheduledAt = useScheduler
          ? new Date(now.getTime() + (batchIndex + 1) * intervalSecs * 1000)
          : new Date(now.getTime() + batchIndex * intervalSecs * 1000);

        batches.push({
          index:      batchIndex,
          recipients: allowed.slice(i, i + batchSize).map((u) => ({
            email: u.email,
            name:  [u.firstname, u.lastname].filter(Boolean).join(" ") || u.name || u.email,
            // data carries all dynamic field values for per-recipient personalisation
            data:  u.data || buildUserData(u),
          })),
          status:     "pending",
          scheduledAt,
        });
        batchIndex++;
      }

      // Convert attachments to base64 so they can be stored in MongoDB and
      // decoded by the Lambda/service when each batch fires
      const storedAttachments = attachments.map((a) => ({
        filename:    a.filename,
        contentType: a.contentType,
        content:     Buffer.isBuffer(a.content)
          ? a.content.toString("base64")
          : a.content,
      }));

      console.log(`[EmailBatch] 📝 Creating job — replyTo: "${replyTo || "not set"}", fromEmail: "${fromEmail || "not set"}"`);

      // Persist the job
      await EmailBatchJob.create({
        jobId,
        status:          useScheduler ? "pending" : "in_progress",
        subject,
        title:           title || "",
        body,
        dynamicFields,
        fromEmail:       fromEmail || null,
        fromName:        fromName  || "VOYCELL",
        replyTo:         replyTo   || null,
        copyTo:          copyTo    || null,
        attachments:     storedAttachments,
        batchSize,
        intervalValue:   batchConfig.intervalValue,
        intervalUnit:    batchConfig.intervalUnit,
        intervalSeconds: intervalSecs,
        totalRecipients: allowed.length,
        droppedCount:    trimmed,
        totalBatches:    batches.length,
        batches,
        createdBy:       req.user._id,
      });

      const fmt = (d) => d.toISOString().replace(/\.\d{3}Z$/, "");
      const unitLabel = `${batchConfig.intervalValue} ${batchConfig.intervalUnit}`;

      if (useScheduler) {
        // ── EventBridge scheduled batches ────────────────────────────────────
        await Promise.allSettled(
          batches.map((b) =>
            createEmailBatchSchedule({
              jobId,
              batchIndex:   b.index,
              scheduleTime: fmt(b.scheduledAt),
              payload:      { jobId, batchIndex: b.index },
            })
          )
        );

        return res.json({
          status:          "success",
          batched:         true,
          scheduled:       true,
          message:         `${allowed.length} emails scheduled across ${batches.length} batch${batches.length !== 1 ? "es" : ""} — 1 batch every ${unitLabel}`,
          jobId,
          totalBatches:    batches.length,
          totalRecipients: allowed.length,
          firstBatchAt:    batches[0]?.scheduledAt,
          lastBatchAt:     batches[batches.length - 1]?.scheduledAt,
          ...(trimmed > 0 && { warning: `${trimmed} recipients trimmed due to sending caps` }),
        });

      } else {
        // ── Direct send with sleep between batches (localhost / sub-60s) ─────
        const { sendEmailBatchService } = require("../services/emailBatchService");
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        console.log(`[EmailBatch] 🖥️  Localhost direct-send: ${batches.length} batch(es), intervalSecs=${intervalSecs} (${batchConfig.intervalValue} ${batchConfig.intervalUnit})`);

        // Fire-and-forget: process batches sequentially in background
        (async () => {
          for (let idx = 0; idx < batches.length; idx++) {
            if (idx > 0 && intervalSecs > 0) {
              console.log(`[EmailBatch] ⏳ Waiting ${intervalSecs}s before batch ${idx}…`);
              await sleep(intervalSecs * 1000);
            }
            console.log(`[EmailBatch] 🚀 Firing batch ${idx} at ${new Date().toISOString()}`);
            await sendEmailBatchService({ jobId, batchIndex: idx });
          }
        })();

        return res.json({
          status:          "success",
          batched:         true,
          scheduled:       false,
          message:         `${allowed.length} emails sending across ${batches.length} batch${batches.length !== 1 ? "es" : ""} — 1 batch every ${unitLabel} (direct mode, interval < 1 min)`,
          jobId,
          totalBatches:    batches.length,
          totalRecipients: allowed.length,
          ...(trimmed > 0 && { warning: `${trimmed} recipients trimmed due to sending caps` }),
        });
      }

    } else {
      // ── IMMEDIATE MODE: send all at once (with per-recipient personalisation) ─
      await Promise.allSettled(
        allowed.map((u) => {
          const recipientData    = u.data || buildUserData(u);
          const personalSubject  = applyDynamicFields(subject, recipientData);
          const personalTitle    = applyDynamicFields(title,   recipientData);
          const personalBody     = applyDynamicFields(body,    recipientData);
          return sendAdminBroadcastEmail({
            to: u.email,
            subject:     personalSubject,
            title:       personalTitle,
            body:        personalBody,
            fromEmail,
            fromName,
            replyTo,
            attachments,
          });
        })
      );

      // Send silent copy
      if (copyTo) {
        console.log(`[CopyTo] Sending silent copy to ${copyTo}`);
        sendAdminBroadcastEmail({
          to: copyTo, subject, title, body, fromEmail, fromName, replyTo, attachments,
        })
          .then(() => console.log(`[CopyTo] ✅ Silent copy delivered to ${copyTo}`))
          .catch((err) => console.error(`[CopyTo] ❌ Failed to send copy to ${copyTo}:`, err.message));
      }

      const targetCompanyNames = target === "specific"
        ? allowed.map((u) => u.userInfo?.companyName || u.firstname || u.email)
        : [];

      await EmailLog.create({
        subject,
        title:              title || "",
        body,
        target,
        targetCompanyIds:   target === "specific" ? targetCompanyIds : [],
        targetCompanyNames,
        recipientCount:     allowed.length,
        recipients: allowed.map((u) => ({
          email:  u.email,
          name:   [u.firstname, u.lastname].filter(Boolean).join(" ") || u.name || u.email,
          userId: u._id,
        })),
        fromEmail:  fromEmail || "noreply@voycell.com",
        fromName:   fromName  || "VOYCELL",
        createdBy:  req.user._id,
      });

      return res.json({
        status:  "success",
        batched: false,
        message: `Email sent to ${allowed.length} user(s)`,
        ...(trimmed > 0 && { warning: `${trimmed} recipients trimmed due to sending caps` }),
      });
    }
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── GET /notifications/email-logs  (superAdmin — paginated list) ────────────
exports.getEmailLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      EmailLog.find()
        .populate("createdBy", "firstname lastname email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      EmailLog.countDocuments(),
    ]);

    // Return logs without the full recipients array (only the count)
    const stripped = logs.map(({ recipients, ...rest }) => ({
      ...rest,
      recipientCount: rest.recipientCount || (recipients ? recipients.length : 0),
    }));

    res.json({ status: "success", data: stripped, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── GET /notifications/email-logs/:id  (superAdmin — recipient detail) ───────
exports.getEmailLogById = async (req, res) => {
  try {
    const log = await EmailLog.findById(req.params.id)
      .populate("createdBy", "firstname lastname email")
      .lean();
    if (!log) return res.status(404).json({ status: "error", message: "Log not found" });
    res.json({ status: "success", data: log });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};
