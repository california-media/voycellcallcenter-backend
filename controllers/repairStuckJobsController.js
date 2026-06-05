const EmailBatchJob = require("../models/EmailBatchJob");
const { finalizeBatchJobIfComplete } = require("../services/emailBatchService");

// ── POST /notifications/repair-stuck-jobs  (superAdmin only) ──────────────────
// One-time (and safely re-runnable) repair for EmailBatchJob documents that are
// stuck as "in_progress" with completedBatches >= totalBatches.
//
// Root cause: the daily cap early-return path in emailBatchService incremented
// completedBatches to totalBatches but returned before the finalization step that
// sets status "completed"/"failed" and creates the EmailLog. This fix is now in
// the service, but existing stuck jobs need a one-time repair.
//
// Safe to run multiple times — finalizeBatchJobIfComplete guards against
// double-execution (checks status + existing EmailLog before acting).
exports.repairStuckJobs = async (req, res) => {
  try {
    // Find all jobs that are stuck: in_progress but all batches accounted for
    const stuckJobs = await EmailBatchJob.find({
      status: "in_progress",
      $expr: { $gte: ["$completedBatches", "$totalBatches"] },
    }).select("jobId completedBatches totalBatches failedBatches createdAt").lean();

    console.log(`[RepairStuckJobs] Found ${stuckJobs.length} stuck jobs`);

    if (!stuckJobs.length) {
      return res.json({
        status:   "success",
        message:  "No stuck jobs found — nothing to repair",
        repaired: 0,
      });
    }

    let repaired = 0;
    let failed   = 0;
    const details = [];

    for (const job of stuckJobs) {
      try {
        await finalizeBatchJobIfComplete(job.jobId);
        repaired++;
        details.push({ jobId: job.jobId, result: "repaired" });
        console.log(`[RepairStuckJobs] ✅ Repaired job ${job.jobId}`);
      } catch (err) {
        failed++;
        details.push({ jobId: job.jobId, result: "error", error: err.message });
        console.error(`[RepairStuckJobs] ❌ Failed to repair job ${job.jobId}:`, err.message);
      }
    }

    res.json({
      status:   failed > 0 && repaired === 0 ? "error" : "success",
      message:  `Repaired ${repaired}/${stuckJobs.length} stuck jobs${failed > 0 ? ` (${failed} failed)` : ""}`,
      repaired,
      failed,
      total:    stuckJobs.length,
      details,
    });
  } catch (err) {
    console.error("[RepairStuckJobs] Error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ── GET /notifications/repair-stuck-jobs  (superAdmin only) ───────────────────
// Dry-run: returns list of stuck jobs without repairing them.
exports.listStuckJobs = async (req, res) => {
  try {
    const stuckJobs = await EmailBatchJob.find({
      status: "in_progress",
      $expr: { $gte: ["$completedBatches", "$totalBatches"] },
    })
      .select("jobId completedBatches totalBatches failedBatches subject createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      status: "success",
      count:  stuckJobs.length,
      data:   stuckJobs,
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};
