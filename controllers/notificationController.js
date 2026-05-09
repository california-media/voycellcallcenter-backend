const { randomUUID } = require("crypto");
const mongoose        = require("mongoose");
const Notification    = require("../models/Notification");
const NotificationLog = require("../models/NotificationLog");
const EmailLog        = require("../models/EmailLog");
const EmailBatchConfig= require("../models/EmailBatchConfig");
const EmailBatchJob   = require("../models/EmailBatchJob");
const SesEmailEvent   = require("../models/SesEmailEvent");
const SesMessageLog   = require("../models/SesMessageLog");
const User            = require("../models/userModel");
const { sendAdminBroadcastEmail }   = require("../utils/emailUtils");
const { createEmailBatchSchedule }  = require("../services/awsScheduler");

// Build a $or match for SesEmailEvent that covers all linking strategies.
// Returns { orConditions, sesMessageIds } for reuse.
async function buildEventMatch(emailLogId, { recipientEmails = [], sentAt = null } = {}) {
  const id = typeof emailLogId === "string"
    ? new mongoose.Types.ObjectId(emailLogId)
    : emailLogId;

  const sesLogs      = await SesMessageLog.find({ emailLogId: id }).select("sesMessageId").lean();
  const sesMessageIds = sesLogs.map((s) => s.sesMessageId).filter(Boolean);

  // Path 1 — direct emailLogId tag
  const orConditions = [{ emailLogId: id }];

  // Path 2 — sesMessageId link
  if (sesMessageIds.length) {
    orConditions.push({ sesMessageId: { $in: sesMessageIds } });
  }

  // Path 3 (removed) — recipient email + timestamp range was a fallback for when
  // emailLogId was not stored. It caused cross-send contamination when the same
  // addresses were reused within the buffer window. Paths 1 & 2 are sufficient
  // because emailLogId is now always stored on every SesEmailEvent.

  return { id, orConditions, sesMessageIds };
}

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
    const { subject, title, body, target = "all", fromSenderId, replyTo, startAt } = req.body;

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

    const copyTo = null; // monitoring copy disabled

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

      // If a future startAt was provided, shift the entire schedule to begin there.
      // We enforce a minimum of "now + 2 minutes" so EventBridge never rejects
      // a schedule that is too close to the current time (AWS requires >= 1 min,
      // we use 2 min as a safety buffer for API call latency).
      const MIN_BUFFER_MS = 2 * 60 * 1000; // 2 minutes
      const scheduleBase = startAt
        ? Math.max(new Date(startAt).getTime(), now.getTime() + MIN_BUFFER_MS)
        : now.getTime() + MIN_BUFFER_MS;

      for (let i = 0; i < allowed.length; i += batchSize) {
        // For scheduler mode: batch 0 fires at scheduleBase, then +intervalSecs per batch
        // For direct mode: same offset from scheduleBase (0 delay for batch 0)
        const scheduledAt = useScheduler
          ? new Date(scheduleBase + batchIndex * intervalSecs * 1000)
          : new Date(scheduleBase + batchIndex * intervalSecs * 1000);

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
        totalRecipients:  allowed.length,
        droppedCount:     trimmed,
        totalBatches:     batches.length,
        // Store the user's raw startAt (before the 2-min buffer) so the UI can
        // distinguish a scheduled batch from an immediate one unambiguously.
        scheduledStartAt: startAt ? new Date(startAt) : null,
        batches,
        createdBy:        req.user._id,
      });

      const fmt = (d) => d.toISOString().replace(/\.\d{3}Z$/, "");
      const unitLabel = `${batchConfig.intervalValue} ${batchConfig.intervalUnit}`;

      if (useScheduler) {
        // ── EventBridge scheduled batches ─────────────────────────────────────
        // PARALLEL creation — all schedules fire at once so API Gateway's 29-second
        // hard timeout is never hit even for 2000+ email jobs (228 batches × ~5ms = ~1s).
        // Promise.allSettled means we never throw — we inspect EVERY result and
        // write failures to MongoDB immediately so nothing is ever silently lost.
        const scheduleResults = await Promise.allSettled(
          batches.map((b) =>
            createEmailBatchSchedule({
              jobId,
              batchIndex:   b.index,
              scheduleTime: fmt(b.scheduledAt),
              payload:      { jobId, batchIndex: b.index },
            })
          )
        );

        const successfulBatchIdxs = [];
        const failedBatchIdxs     = [];

        scheduleResults.forEach((result, i) => {
          if (result.status === "fulfilled") {
            successfulBatchIdxs.push(i);
          } else {
            failedBatchIdxs.push(i);
            // Log the full AWS error so it appears in CloudWatch — helps diagnose
            // IAM permission issues, wrong ARN, region mismatch, etc.
            console.error(
              `[EmailBatch] ❌ Schedule creation failed for batch ${i} of job ${jobId}:`,
              result.reason?.name,        // e.g. "AccessDeniedException"
              result.reason?.message,     // e.g. "User is not authorized to perform..."
              result.reason?.$metadata?.httpStatusCode  // e.g. 403
            );
          }
        });

        // One DB write for all failed batches
        if (failedBatchIdxs.length > 0) {
          await EmailBatchJob.findOneAndUpdate(
            { jobId },
            {
              $set: Object.fromEntries([
                ...failedBatchIdxs.map((idx) => [`batches.${idx}.status`, "failed"]),
                ...failedBatchIdxs.map((idx) => [
                  `batches.${idx}.error`,
                  `EventBridge schedule creation failed: ${scheduleResults[idx].reason?.message || "Unknown error"}`,
                ]),
              ]),
              $inc: {
                completedBatches: failedBatchIdxs.length,
                failedBatches:    failedBatchIdxs.length,
              },
            }
          );
        }

        // One DB write for all successful batches — flip scheduledInEventBridge: true
        // Any batch still showing false + status "pending" has no real EventBridge
        // schedule and will never fire — easily visible in the UI.
        if (successfulBatchIdxs.length > 0) {
          await EmailBatchJob.findOneAndUpdate(
            { jobId },
            {
              $set: Object.fromEntries(
                successfulBatchIdxs.map((idx) => [`batches.${idx}.scheduledInEventBridge`, true])
              ),
            }
          );
        }

        const scheduledCount = successfulBatchIdxs.length;
        console.log(`[EmailBatch] ✅ Job ${jobId}: ${scheduledCount}/${batches.length} schedules created in EventBridge${failedBatchIdxs.length ? ` | ❌ Failed batches: [${failedBatchIdxs.join(", ")}]` : ""}`);

        return res.json({
          status:          failedBatchIdxs.length > 0 ? "partial" : "success",
          batched:         true,
          scheduled:       true,
          message:         `${allowed.length} emails scheduled across ${scheduledCount} batch${scheduledCount !== 1 ? "es" : ""} — 1 batch every ${unitLabel}${failedBatchIdxs.length ? ` (⚠️ ${failedBatchIdxs.length} batch(es) failed to schedule)` : ""}`,
          jobId,
          totalBatches:    batches.length,
          scheduledBatches: scheduledCount,
          failedBatches:   failedBatchIdxs,
          totalRecipients: allowed.length,
          firstBatchAt:    batches[0]?.scheduledAt,
          lastBatchAt:     batches[batches.length - 1]?.scheduledAt,
          ...(trimmed > 0 && { warning: `${trimmed} recipients trimmed due to sending caps` }),
          // Actual AWS error reasons — visible in browser network tab / response
          // so you can diagnose without needing CloudWatch access
          ...(failedBatchIdxs.length > 0 && {
            scheduleError: scheduleResults
              .filter((r) => r.status === "rejected")
              .map((r) => `${r.reason?.name || "Error"}: ${r.reason?.message || "Unknown"}`)
              [0] ?? "Unknown error",
          }),
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
      const SesMessageLog = require("../models/SesMessageLog");

      const sendResults = await Promise.allSettled(
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

      // Send silent copy (fire-and-forget, no tracking needed)
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

      // Create EmailLog first so we have its _id for SesMessageLog entries
      const emailLog = await EmailLog.create({
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

      // Map each successful send's SES messageId → EmailLog + recipient
      const sesLogDocs = [];
      sendResults.forEach((result, idx) => {
        if (result.status === "fulfilled" && result.value?.sesMessageId) {
          sesLogDocs.push({
            sesMessageId:   result.value.sesMessageId,
            emailLogId:     emailLog._id,
            batchJobId:     null,
            recipientEmail: allowed[idx]?.email || "",
            sentAt:         new Date(),
          });
        }
      });
      if (sesLogDocs.length) {
        SesMessageLog.insertMany(sesLogDocs, { ordered: false }).catch((err) =>
          console.error("[SesMessageLog] Insert error (immediate):", err.message)
        );
      }

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
const EVENT_STATS_MAP = {
  Send: "sends", Delivery: "deliveries", Open: "opens",
  Click: "clicks", Bounce: "bounces", Complaint: "complaints", Reject: "rejections",
};

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

    // Strip recipients from each log (only keep count)
    const stripped = logs.map(({ recipients, ...rest }) => ({
      ...rest,
      recipientCount: rest.recipientCount || (recipients ? recipients.length : 0),
    }));

    // ── Compute live stats from SesEmailEvent for this page ──────────────────
    const logIds = logs.map((l) => l._id);

    // Build a map of logId → Set<lowercased recipientEmails>.
    // All comparisons are case-insensitive so SES email casing (e.g. "Alice@Co.COM")
    // matches the stored recipients (e.g. "alice@co.com").
    const recipientEmailsByLogId = {};
    logs.forEach((log) => {
      if (log.recipients && log.recipients.length > 0) {
        recipientEmailsByLogId[log._id.toString()] = new Set(
          log.recipients.map((r) => (r.email || "").toLowerCase()).filter(Boolean)
        );
      }
    });

    const resolveEventType = {
      $cond: {
        if: { $eq: ["$eventType", "Unknown"] },
        then: "$raw.eventType",
        else: "$eventType",
      },
    };

    // ── Single per-recipient aggregation — same logic as getEmailLogById ─────────
    // This guarantees the table and modal always show identical numbers.
    // Step 1: build sesMessageId → emailLogId map for the fallback path
    const sesLogs = await SesMessageLog.find({ emailLogId: { $in: logIds } })
      .select("sesMessageId emailLogId")
      .lean();
    const msgIdToLogId = {};
    sesLogs.forEach((sl) => {
      if (sl.sesMessageId) msgIdToLogId[sl.sesMessageId] = sl.emailLogId.toString();
    });
    const allSesIds = Object.keys(msgIdToLogId);

    // Step 2: fetch all events for these logs via both paths in one query
    const allOrConditions = [
      { emailLogId: { $in: logIds } },
      ...(allSesIds.length ? [{ sesMessageId: { $in: allSesIds } }] : []),
    ];

    const perRecipientAgg = await SesEmailEvent.aggregate([
      { $match: { $or: allOrConditions } },
      // Collect all event flags per (emailLogId, sesMessageId, email)
      {
        $group: {
          _id: {
            emailLogId:  "$emailLogId",
            sesMessageId: "$sesMessageId",
            // Normalise to lowercase so "Alice@Co.COM" and "alice@co.com" are the same key
            email: { $toLower: { $ifNull: ["$recipientEmail", ""] } },
          },
          hasDelivery:  { $max: { $cond: [{ $eq: ["$eventType", "Delivery"]  }, 1, 0] } },
          hasOpen:      { $max: { $cond: [{ $eq: ["$eventType", "Open"]      }, 1, 0] } },
          hasClick:     { $max: { $cond: [{ $eq: ["$eventType", "Click"]     }, 1, 0] } },
          hasBounce:    { $max: { $cond: [{ $eq: ["$eventType", "Bounce"]    }, 1, 0] } },
          hasComplaint: { $max: { $cond: [{ $eq: ["$eventType", "Complaint"] }, 1, 0] } },
          hasReject:    { $max: { $cond: [{ $in:  ["$eventType", ["Reject", "RenderingFailure"]] }, 1, 0] } },
          hasSend:      { $max: { $cond: [{ $eq: ["$eventType", "Send"]      }, 1, 0] } },
        },
      },
    ]);

    // Step 3: resolve logId and merge flags per (logId, email)
    // An email can appear via BOTH emailLogId and sesMessageId paths — take the max flag.
    // Only count events for emails that are actually in log.recipients (same filter the
    // modal uses) so outer table and modal statistics always match.
    // Email comparison is case-insensitive (the aggregate already lowercased emails).
    const recipientFlagsMap = {}; // logKey → { email → flags }
    for (const doc of perRecipientAgg) {
      const logKey = doc._id.emailLogId
        ? doc._id.emailLogId.toString()
        : (msgIdToLogId[doc._id.sesMessageId] || null);
      if (!logKey) continue;

      // email is already lowercased by $toLower in the aggregate
      const email = doc._id.email || "";
      if (!email) continue;

      // Skip events for emails not in the recipient list (guards against stray SES
      // events for forwarded/monitored addresses that are not actual recipients)
      const recipientSet = recipientEmailsByLogId[logKey];
      if (recipientSet && recipientSet.size > 0 && !recipientSet.has(email)) continue;

      if (!recipientFlagsMap[logKey]) recipientFlagsMap[logKey] = {};
      if (!recipientFlagsMap[logKey][email]) {
        recipientFlagsMap[logKey][email] = { hasDelivery: 0, hasOpen: 0, hasClick: 0, hasBounce: 0, hasComplaint: 0, hasReject: 0, hasSend: 0 };
      }
      const f = recipientFlagsMap[logKey][email];
      f.hasDelivery  = Math.max(f.hasDelivery,  doc.hasDelivery);
      f.hasOpen      = Math.max(f.hasOpen,      doc.hasOpen);
      f.hasClick     = Math.max(f.hasClick,     doc.hasClick);
      f.hasBounce    = Math.max(f.hasBounce,    doc.hasBounce);
      f.hasComplaint = Math.max(f.hasComplaint, doc.hasComplaint);
      f.hasReject    = Math.max(f.hasReject,    doc.hasReject);
      f.hasSend      = Math.max(f.hasSend,      doc.hasSend);
    }

    // Step 4: count stats per logId from per-recipient flags
    const statsMap = {};
    for (const [logKey, emailMap] of Object.entries(recipientFlagsMap)) {
      const s = { sends: 0, deliveries: 0, netDeliveries: 0, opens: 0, clicks: 0, bounces: 0, complaints: 0, rejections: 0 };
      for (const f of Object.values(emailMap)) {
        if (f.hasSend)                         s.sends++;
        if (f.hasDelivery)                     s.deliveries++;
        if (f.hasDelivery && !f.hasBounce)     s.netDeliveries++;  // delivered AND not bounced
        if (f.hasOpen)                         s.opens++;
        if (f.hasClick)                        s.clicks++;
        if (f.hasBounce)                       s.bounces++;
        if (f.hasComplaint)                    s.complaints++;
        if (f.hasReject)                       s.rejections++;
      }
      statsMap[logKey] = s;
    }

    // Step 5: build final stats — always use live per-recipient computation.
    // Never short-circuit on stored stats, because stored stats may have been saved
    // by old code before the recipient-filter fix and could be inflated.
    const finalLogs = stripped.map((log) => {
      const live   = statsMap[log._id.toString()];
      const stored = log.stats || {};

      const merged = live || {
        sends:         stored.sends         || 0,
        deliveries:    stored.deliveries    || 0,
        netDeliveries: stored.netDeliveries || 0,
        opens:         stored.opens         || 0,
        clicks:        stored.clicks        || 0,
        bounces:       stored.bounces       || 0,
        complaints:    stored.complaints    || 0,
        rejections:    stored.rejections    || 0,
      };

      // Persist whenever the live value differs from stored (keeps stored fresh)
      if (live) {
        const changed = Object.keys(merged).some((k) => (merged[k] || 0) !== (stored[k] || 0));
        if (changed) EmailLog.findByIdAndUpdate(log._id, { $set: { stats: merged } }).catch(() => {});
      }
      return { ...log, stats: merged };
    });

    res.json({ status: "success", data: finalLogs, total, page: parseInt(page), limit: parseInt(limit) });
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

    const recipientEmails = (log.recipients || []).map((r) => r.email).filter(Boolean);
    const { orConditions } = await buildEventMatch(req.params.id, {
      recipientEmails,
      sentAt: log.createdAt,
    });

    const resolveType = {
      $cond: { if: { $eq: ["$eventType", "Unknown"] }, then: "$raw.eventType", else: "$eventType" },
    };

    // Single aggregation: stats + first-event timestamp per recipient per type.
    // We deduplicate by (recipientEmail, eventType) so SNS duplicate deliveries
    // don't inflate counts — this gives standard "unique opens/deliveries" metrics.
    const [statsAgg, recipientEventsAgg] = await Promise.all([
      SesEmailEvent.aggregate([
        { $match: { $or: orConditions } },
        { $addFields: { _effectiveType: resolveType } },
        // Deduplicate: one entry per unique (recipient, eventType)
        { $group: { _id: { email: "$recipientEmail", eventType: "$_effectiveType" }, firstAt: { $min: "$timestamp" } } },
        // Count unique recipients per eventType
        { $group: { _id: "$_id.eventType", count: { $sum: 1 } } },
      ]),
      SesEmailEvent.aggregate([
        { $match: { $or: orConditions } },
        { $addFields: { _effectiveType: resolveType } },
        { $sort: { timestamp: 1 } },
        {
          $group: {
            _id: { email: "$recipientEmail", type: "$_effectiveType" },
            firstAt: { $first: "$timestamp" },
          },
        },
      ]),
    ]);

    // Build stats object
    const counts = {};
    statsAgg.forEach(({ _id, count }) => { counts[_id] = count; });
    const liveStats = {
      sends:       counts.Send       || 0,
      deliveries:  counts.Delivery   || 0,
      opens:       counts.Open       || 0,
      clicks:      counts.Click      || 0,
      bounces:     counts.Bounce     || 0,
      complaints:  counts.Complaint  || 0,
      rejections:  counts.Reject     || 0,
    };

    // Build per-recipient event map: { email: { Delivery: date, Open: date, … } }
    // Keys are normalised to lowercase — SES sometimes returns different casing than stored.
    const recipientEventMap = {};
    recipientEventsAgg.forEach(({ _id, firstAt }) => {
      const emailKey = (_id.email || "").toLowerCase();
      if (!recipientEventMap[emailKey]) recipientEventMap[emailKey] = {};
      recipientEventMap[emailKey][_id.type] = firstAt;
    });

    // Enrich recipients with event timestamps
    const enrichedRecipients = (log.recipients || []).map((r) => ({
      ...r,
      events: recipientEventMap[(r.email || "").toLowerCase()] || {},
    }));

    // ── Compute accurate per-recipient stats ──────────────────────────────────
    // Count only from log.recipients (same as what the modal's Statistics tab
    // and Recipients tab show).  liveStats from the aggregate above may count
    // events for emails NOT in the recipient list (e.g. forwarded/tracked by
    // third parties), inflating numbers.  These per-recipient stats are saved
    // back to EmailLog.stats with a marker so getEmailLogs can use them instead
    // of re-running the aggregate (which would produce the inflated figure).
    const perRecipientStats = {
      sends:                  liveStats.sends,   // SES Send events — keep aggregate value
      deliveries:             enrichedRecipients.filter((r) => r.events?.Delivery).length,
      netDeliveries:          enrichedRecipients.filter((r) => r.events?.Delivery && !r.events?.Bounce).length,
      opens:                  enrichedRecipients.filter((r) => r.events?.Open).length,
      clicks:                 enrichedRecipients.filter((r) => r.events?.Click).length,
      bounces:                enrichedRecipients.filter((r) => r.events?.Bounce).length,
      complaints:             enrichedRecipients.filter((r) => r.events?.Complaint).length,
      rejections:             enrichedRecipients.filter((r) => r.events?.Reject).length,
      statsComputedPerRecipient: true,  // flag: outer table should use these, not re-aggregate
    };

    const hasEvents = Object.entries(perRecipientStats)
      .filter(([k]) => k !== "statsComputedPerRecipient")
      .some(([, v]) => (v || 0) > 0);

    if (hasEvents) {
      EmailLog.findByIdAndUpdate(req.params.id, { $set: { stats: perRecipientStats } }).catch(() => {});
    }

    res.json({ status: "success", data: { ...log, stats: perRecipientStats, recipients: enrichedRecipients } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── GET /notifications/email-logs/:id/recipients  (paginated + filtered) ──────
// Supports:  ?page=1&limit=20&filter=all|delivered|opened|bounced
// ?download=true  returns ALL matching recipients without pagination (for Excel)
exports.getEmailLogRecipients = async (req, res) => {
  try {
    const log = await EmailLog.findById(req.params.id)
      .select("recipients createdAt subject")
      .lean();
    if (!log) return res.status(404).json({ status: "error", message: "Log not found" });

    const page     = parseInt(req.query.page)  || 1;
    const limit    = parseInt(req.query.limit) || 20;
    const filter   = req.query.filter   || "all";   // all | delivered | opened | bounced
    const download = req.query.download === "true"; // bypass pagination

    const recipientEmails = (log.recipients || []).map((r) => r.email).filter(Boolean);
    const { orConditions } = await buildEventMatch(req.params.id, { recipientEmails, sentAt: log.createdAt });

    const resolveType = {
      $cond: { if: { $eq: ["$eventType", "Unknown"] }, then: "$raw.eventType", else: "$eventType" },
    };

    // Build per-recipient event map
    const recipientEventsAgg = await SesEmailEvent.aggregate([
      { $match: { $or: orConditions } },
      { $addFields: { _effectiveType: resolveType } },
      { $sort: { timestamp: 1 } },
      { $group: { _id: { email: "$recipientEmail", type: "$_effectiveType" }, firstAt: { $first: "$timestamp" } } },
    ]);
    const recipientEventMap = {};
    recipientEventsAgg.forEach(({ _id, firstAt }) => {
      const emailKey = (_id.email || "").toLowerCase();
      if (!recipientEventMap[emailKey]) recipientEventMap[emailKey] = {};
      recipientEventMap[emailKey][_id.type] = firstAt;
    });

    // Enrich and filter
    let enriched = (log.recipients || []).map((r) => ({
      ...r,
      events: recipientEventMap[(r.email || "").toLowerCase()] || {},
    }));

    if (filter === "delivered") {
      enriched = enriched.filter((r) => r.events?.Delivery && !r.events?.Bounce);
    } else if (filter === "opened") {
      enriched = enriched.filter((r) => r.events?.Open);
    } else if (filter === "bounced") {
      enriched = enriched.filter((r) => r.events?.Bounce);
    }

    const total = enriched.length;

    const paged = download
      ? enriched
      : enriched.slice((page - 1) * limit, page * limit);

    res.json({
      status: "success",
      data:   paged,
      total,
      page:   download ? 1 : page,
      limit:  download ? total : limit,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ─── GET /notifications/email-logs/:id/sync-stats  (force refresh stats) ──────
exports.syncEmailLogStats = async (req, res) => {
  try {
    const log = await EmailLog.findById(req.params.id).lean();
    if (!log) return res.status(404).json({ status: "error", message: "Log not found" });

    const recipientEmails = (log.recipients || []).map((r) => r.email).filter(Boolean);
    const { orConditions } = await buildEventMatch(req.params.id, {
      recipientEmails,
      sentAt: log.createdAt,
    });

    const statsAgg = await SesEmailEvent.aggregate([
      { $match: { $or: orConditions } },
      {
        $addFields: {
          _effectiveType: {
            $cond: { if: { $eq: ["$eventType", "Unknown"] }, then: "$raw.eventType", else: "$eventType" },
          },
        },
      },
      { $group: { _id: { email: "$recipientEmail", eventType: "$_effectiveType" } } },
      { $group: { _id: "$_id.eventType", count: { $sum: 1 } } },
    ]);

    const counts = {};
    statsAgg.forEach(({ _id, count }) => { counts[_id] = count; });
    const liveStats = {
      sends:       counts.Send       || 0,
      deliveries:  counts.Delivery   || 0,
      opens:       counts.Open       || 0,
      clicks:      counts.Click      || 0,
      bounces:     counts.Bounce     || 0,
      complaints:  counts.Complaint  || 0,
      rejections:  counts.Reject     || 0,
    };

    await EmailLog.findByIdAndUpdate(req.params.id, { $set: { stats: liveStats } });
    res.json({ status: "success", stats: liveStats });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};
