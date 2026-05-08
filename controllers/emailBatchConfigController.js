const EmailBatchConfig = require("../models/EmailBatchConfig");
const EmailBatchJob    = require("../models/EmailBatchJob");
const EmailLog         = require("../models/EmailLog");
const SesEmailEvent    = require("../models/SesEmailEvent");
const SesMessageLog    = require("../models/SesMessageLog");
const { deleteEmailBatchSchedule } = require("../services/awsScheduler");

// Maps SES event types to stats field names (same as notificationController)
const emptyStats = () => ({ sends: 0, deliveries: 0, opens: 0, clicks: 0, bounces: 0, complaints: 0, rejections: 0 });

const EVENT_STATS_MAP = {
  Send:              "sends",
  Delivery:          "deliveries",
  Open:              "opens",
  Click:             "clicks",
  Bounce:            "bounces",
  Complaint:         "complaints",
  Reject:            "rejections",
  RenderingFailure:  "rejections",
};

// ── GET /notifications/batch-config ──────────────────────────────────────────
exports.getBatchConfig = async (req, res) => {
  try {
    let config = await EmailBatchConfig.findOne({ key: "global" });
    if (!config) {
      config = await EmailBatchConfig.create({ key: "global" });
    }
    res.json({ status: "success", data: config });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const UNIT_TO_SECONDS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };

const toSeconds = (value, unit) =>
  Math.round(Number(value) * (UNIT_TO_SECONDS[unit] || 60));

// ── PUT /notifications/batch-config ──────────────────────────────────────────
exports.updateBatchConfig = async (req, res) => {
  try {
    const { enabled, batchSize, intervalValue, intervalUnit, dailyCap } = req.body;

    const update = {};
    if (enabled       !== undefined) update.enabled       = !!enabled;
    if (batchSize     !== undefined) update.batchSize     = Number(batchSize);
    if (dailyCap      !== undefined) update.dailyCap      = Number(dailyCap);

    // Update interval — recalculate intervalSeconds whenever either part changes
    if (intervalValue !== undefined) update.intervalValue = Number(intervalValue);
    if (intervalUnit  !== undefined) update.intervalUnit  = intervalUnit;

    // Re-derive intervalSeconds from the latest value+unit combo
    if (intervalValue !== undefined || intervalUnit !== undefined) {
      // Need current values to fill in whichever wasn't sent
      const current = await EmailBatchConfig.findOne({ key: "global" }).lean();
      const v = intervalValue !== undefined ? Number(intervalValue) : (current?.intervalValue ?? 1);
      const u = intervalUnit  !== undefined ? intervalUnit           : (current?.intervalUnit  ?? "minutes");
      update.intervalSeconds = toSeconds(v, u);
    }

    const config = await EmailBatchConfig.findOneAndUpdate(
      { key: "global" },
      update,
      { upsert: true, new: true }
    );
    res.json({ status: "success", data: config });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ── Shared helper: resolve SES stats + per-recipient events for a batch job ──
// Uses SesMessageLog as the authoritative mapping (batchJobId → sesMessageIds)
// then queries SesEmailEvent by sesMessageId.  This is the same two-step
// pattern getEmailLogs uses for completed batches and is immune to the race
// condition where SNS delivers before SesMessageLog.insertMany completes.
async function resolveBatchSesData(jobId) {
  const sesLogs = await SesMessageLog.find({ batchJobId: jobId })
    .select("sesMessageId recipientEmail")
    .lean();

  if (!sesLogs.length) {
    return { recipientEventsMap: {}, stats: emptyStats() };
  }

  const sesMessageIds  = sesLogs.map((sl) => sl.sesMessageId);
  const msgIdToEmail   = {};
  sesLogs.forEach((sl) => { if (sl.sesMessageId) msgIdToEmail[sl.sesMessageId] = sl.recipientEmail; });

  // Fetch all SES events for these messages (any batchJobId / emailLogId value)
  const allEvents = await SesEmailEvent.find({
    sesMessageId: { $in: sesMessageIds },
  }).lean();

  // Build per-recipient event map (first occurrence of each eventType wins)
  const recipientEventsMap = {};
  for (const ev of allEvents) {
    const email = ev.recipientEmail || msgIdToEmail[ev.sesMessageId] || "";
    if (!email) continue;
    if (!recipientEventsMap[email]) recipientEventsMap[email] = {};
    if (!recipientEventsMap[email][ev.eventType]) {
      recipientEventsMap[email][ev.eventType] = ev.timestamp || ev.createdAt;
    }
  }

  // Aggregate per-eventType counts (deduplicated: 1 per recipient per event type)
  const stats = emptyStats();
  for (const events of Object.values(recipientEventsMap)) {
    for (const eventType of Object.keys(events)) {
      const field = EVENT_STATS_MAP[eventType];
      if (field) stats[field]++;
    }
  }

  return { recipientEventsMap, stats };
}

// ── GET /notifications/batch-jobs/:jobId ─────────────────────────────────────
exports.getBatchJobDetail = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await EmailBatchJob.findOne({ jobId });
    if (!job) return res.status(404).json({ status: "error", message: "Job not found" });

    const { recipientEventsMap, stats } = await resolveBatchSesData(jobId);

    // Flatten recipients from all batches and attach per-recipient SES events
    const recipients = job.batches.flatMap((b) =>
      (b.recipients || []).map((r) => ({
        ...r,
        batchIndex:  b.index,
        batchStatus: b.status,
        scheduledAt: b.scheduledAt,
        sentAt:      b.sentAt,
        batchError:  b.error,
        events:      recipientEventsMap[r.email] || {},
      }))
    );

    res.json({
      status: "success",
      data: {
        ...job.toObject(),
        recipients,
        recipientCount: recipients.length,
        stats,
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ── GET /notifications/batch-jobs ─────────────────────────────────────────────
exports.listBatchJobs = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip   = (page - 1) * limit;
    // ?status=active → only pending/in_progress (avoids duplicating completed jobs
    // that already have an EmailLog entry in the history table)
    const filter = status === "active"
      ? { status: { $in: ["pending", "in_progress"] } }
      : {};
    const total = await EmailBatchJob.countDocuments(filter);
    const jobs  = await EmailBatchJob.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    if (!jobs.length) {
      return res.json({ status: "success", data: [], total, page: Number(page), limit: Number(limit) });
    }

    // ── Resolve SES stats for all jobs via the reliable two-step path ─────────
    // Step 1: SesMessageLog is the authoritative batchJobId → sesMessageId map.
    // We use this (not SesEmailEvent.batchJobId) to avoid a race condition where
    // the SNS webhook can arrive before SesMessageLog.insertMany completes, leaving
    // SesEmailEvent.batchJobId = null even though the message belongs to a batch.
    const jobIds = jobs.map((j) => j.jobId);

    const sesLogs = await SesMessageLog.find({ batchJobId: { $in: jobIds } })
      .select("sesMessageId batchJobId")
      .lean();

    const statsMap = {};

    if (sesLogs.length) {
      // Build sesMessageId → jobId map
      const msgIdToJobId = {};
      sesLogs.forEach((sl) => { if (sl.sesMessageId) msgIdToJobId[sl.sesMessageId] = sl.batchJobId; });
      const allMsgIds = Object.keys(msgIdToJobId);

      // Step 2: Aggregate events by sesMessageId — works regardless of whether
      // SesEmailEvent.batchJobId was set correctly.
      const eventAgg = await SesEmailEvent.aggregate([
        { $match: { sesMessageId: { $in: allMsgIds } } },
        // Deduplicate: each recipient counts once per eventType
        {
          $group: {
            _id: { sesMessageId: "$sesMessageId", email: "$recipientEmail", eventType: "$eventType" },
          },
        },
        {
          $group: {
            _id: { sesMessageId: "$_id.sesMessageId", eventType: "$_id.eventType" },
            count: { $sum: 1 },
          },
        },
      ]);

      // Step 3: Map sesMessageId → jobId and accumulate stats
      for (const { _id, count } of eventAgg) {
        const jobId = msgIdToJobId[_id.sesMessageId];
        const field = EVENT_STATS_MAP[_id.eventType];
        if (!jobId || !field) continue;
        if (!statsMap[jobId]) statsMap[jobId] = emptyStats();
        statsMap[jobId][field] += count;
      }
    }

    const jobsWithStats = jobs.map((job) => ({
      ...job.toObject(),
      stats: statsMap[job.jobId] || emptyStats(),
    }));

    res.json({ status: "success", data: jobsWithStats, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ── DELETE /notifications/batch-jobs/:jobId ───────────────────────────────────
// Cancel a pending job — deletes all pending EventBridge schedules
exports.cancelBatchJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await EmailBatchJob.findOne({ jobId });
    if (!job) return res.status(404).json({ status: "error", message: "Job not found" });
    if (!["pending", "in_progress"].includes(job.status)) {
      return res.status(400).json({ status: "error", message: "Only pending or in-progress jobs can be cancelled" });
    }

    // Delete all pending EventBridge schedules for this job
    const pendingBatches = job.batches.filter((b) => b.status === "pending");
    await Promise.allSettled(
      pendingBatches.map((b) => deleteEmailBatchSchedule(jobId, b.index))
    );

    await EmailBatchJob.findOneAndUpdate({ jobId }, { status: "cancelled" });
    res.json({ status: "success", message: `Job ${jobId} cancelled` });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ── DELETE /notifications/ses-events/cleanup ─────────────────────────────────
// Deletes SesEmailEvent records older than N days (default 30).
// Safe to run because:
//   - EmailLog.stats are already aggregated and stored on the EmailLog document
//     (incremented live by the SNS webhook) — they are NOT re-computed from SesEmailEvent
//   - SesMessageLog is NOT deleted here — it stays as the mapping layer
// What you LOSE after deletion:
//   - Per-recipient event breakdown inside a completed batch job detail view
//   - Exact timestamp of when each recipient opened/clicked (for old campaigns)
// What you KEEP:
//   - EmailLog.stats totals (sends/deliveries/opens/clicks/bounces) — always correct
//   - Sent Email History table — fully intact
//   - SesMessageLog mapping — fully intact
exports.cleanupSesEvents = async (req, res) => {
  try {
    const retainDays = Number(req.query.retainDays) || 30;
    const cutoff     = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000);

    const result = await SesEmailEvent.deleteMany({ createdAt: { $lt: cutoff } });

    console.log(`[SesCleanup] Deleted ${result.deletedCount} SesEmailEvent records older than ${retainDays} days`);
    res.json({
      status:       "success",
      deletedCount: result.deletedCount,
      cutoffDate:   cutoff.toISOString(),
      message:      `Deleted ${result.deletedCount} SES event records older than ${retainDays} days. EmailLog stats and Sent Email History are unaffected.`,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ── GET /notifications/send-caps ─────────────────────────────────────────────
// Returns how many emails have been sent in the last hour and last 24h
exports.getSendCaps = async (req, res) => {
  try {
    const now      = new Date();
    const hour1Ago = new Date(now - 60 * 60 * 1000);
    const day1Ago  = new Date(now - 24 * 60 * 60 * 1000);

    const [dailyAgg] = await Promise.all([
      EmailLog.aggregate([
        { $match: { createdAt: { $gte: day1Ago } } },
        { $group: { _id: null, total: { $sum: "$recipientCount" } } },
      ]),
    ]);

    res.json({
      status:    "success",
      dailyUsed: dailyAgg[0]?.total ?? 0,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};
