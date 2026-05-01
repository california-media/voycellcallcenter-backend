const EmailBatchJob = require("../models/EmailBatchJob");
const { sendEmailBatchService } = require("../services/emailBatchService");

// ── POST /notifications/batch-jobs/:jobId/trigger ─────────────────────────────
// Manually triggers all PENDING batches for a job — useful when Lambda hasn't been
// redeployed yet, or for immediate testing without waiting for EventBridge.
exports.triggerBatchJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await EmailBatchJob.findOne({ jobId });

    if (!job) return res.status(404).json({ status: "error", message: "Job not found" });

    if (job.status === "completed") {
      return res.status(400).json({ status: "error", message: "Job is already completed" });
    }

    const pendingBatches = job.batches.filter((b) => b.status === "pending");

    if (!pendingBatches.length) {
      return res.status(400).json({ status: "error", message: "No pending batches to trigger" });
    }

    console.log(`[EmailBatch] 🔧 Manual trigger for job ${jobId} — ${pendingBatches.length} pending batch(es)`);

    // Fire all pending batches sequentially (no interval in manual mode)
    // Run in background so the HTTP response returns immediately
    (async () => {
      for (const batch of pendingBatches) {
        try {
          await sendEmailBatchService({ jobId, batchIndex: batch.index });
        } catch (err) {
          console.error(`[EmailBatch] Manual trigger error on batch ${batch.index}:`, err.message);
        }
      }
    })();

    res.json({
      status:  "success",
      message: `Triggering ${pendingBatches.length} pending batch(es) for job ${jobId}`,
      pendingBatches: pendingBatches.length,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};
