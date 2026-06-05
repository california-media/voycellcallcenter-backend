const EmailBatchJob = require("../models/EmailBatchJob");
const { sendEmailBatchService } = require("../services/emailBatchService");

// ── POST /notifications/batch-jobs/:jobId/trigger ─────────────────────────────
// Manually triggers all triggerable batches for a job.
// Triggerable batches:
//   1. status === "pending"                         — scheduled but not yet fired
//   2. status === "failed" && !scheduledInEventBridge — EventBridge never created
//      the schedule so the batch will never fire on its own; safe to re-run since
//      succeededCount === 0 (nothing was ever sent)
exports.triggerBatchJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await EmailBatchJob.findOne({ jobId });

    if (!job) return res.status(404).json({ status: "error", message: "Job not found" });

    if (job.status === "completed") {
      return res.status(400).json({ status: "error", message: "Job is already completed" });
    }

    if (job.status === "cancelled") {
      return res.status(400).json({ status: "error", message: "Job is cancelled" });
    }

    // Pending batches — scheduled but haven't fired yet
    const pendingBatches = job.batches.filter((b) => b.status === "pending");

    // Failed batches where EventBridge never actually created the schedule.
    // These are safe to re-trigger because 0 emails were ever sent (succeededCount === 0).
    const unscheduledFailedBatches = job.batches.filter(
      (b) => b.status === "failed" && !b.scheduledInEventBridge && (b.succeededCount || 0) === 0
    );

    const batchesToTrigger = [...pendingBatches, ...unscheduledFailedBatches];

    if (!batchesToTrigger.length) {
      return res.status(400).json({
        status: "error",
        message: "No triggerable batches found. Pending batches: 0. Failed-unscheduled batches: 0.",
      });
    }

    console.log(
      `[EmailBatch] 🔧 Manual trigger for job ${jobId} — ` +
      `${pendingBatches.length} pending + ${unscheduledFailedBatches.length} failed-unscheduled`
    );

    // Reset failed-unscheduled batches back to "pending" so sendEmailBatchService
    // doesn't skip them (it only skips status === "sent")
    if (unscheduledFailedBatches.length > 0) {
      const resetOps = {};
      for (const b of unscheduledFailedBatches) {
        resetOps[`batches.${b.index}.status`] = "pending";
        resetOps[`batches.${b.index}.error`]  = null;
        // Reverse the completedBatches/failedBatches counters that were incremented
        // when EventBridge schedule creation failed, so finalization count stays accurate
      }
      await EmailBatchJob.findOneAndUpdate(
        { jobId },
        {
          $set: resetOps,
          $inc: {
            completedBatches: -unscheduledFailedBatches.length,
            failedBatches:    -unscheduledFailedBatches.length,
          },
        }
      );
    }

    // Fire all triggerable batches sequentially in background (no interval in manual mode)
    (async () => {
      for (const batch of batchesToTrigger) {
        try {
          await sendEmailBatchService({ jobId, batchIndex: batch.index });
        } catch (err) {
          console.error(`[EmailBatch] Manual trigger error on batch ${batch.index}:`, err.message);
        }
      }
    })();

    res.json({
      status:  "success",
      message: `Triggering ${batchesToTrigger.length} batch(es) for job ${jobId} (${pendingBatches.length} pending + ${unscheduledFailedBatches.length} failed-unscheduled)`,
      pendingBatches:            pendingBatches.length,
      unscheduledFailedBatches:  unscheduledFailedBatches.length,
      totalTriggered:            batchesToTrigger.length,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};
