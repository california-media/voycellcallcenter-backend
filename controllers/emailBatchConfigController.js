const EmailBatchConfig = require("../models/EmailBatchConfig");
const EmailBatchJob    = require("../models/EmailBatchJob");
const EmailLog         = require("../models/EmailLog");
const { deleteEmailBatchSchedule } = require("../services/awsScheduler");

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

// ── GET /notifications/batch-jobs/:jobId ─────────────────────────────────────
exports.getBatchJobDetail = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await EmailBatchJob.findOne({ jobId });
    if (!job) return res.status(404).json({ status: "error", message: "Job not found" });

    // Flatten all recipients from all batches for the recipients tab
    const recipients = job.batches.flatMap((b) => b.recipients || []);
    const recipientCount = recipients.length;

    res.json({
      status: "success",
      data: {
        ...job.toObject(),
        recipients,
        recipientCount,
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

    res.json({ status: "success", data: jobs, total, page: Number(page), limit: Number(limit) });
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
