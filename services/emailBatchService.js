const EmailBatchJob    = require("../models/EmailBatchJob");
const EmailLog         = require("../models/EmailLog");
const EmailBatchConfig = require("../models/EmailBatchConfig");
const SesMessageLog    = require("../models/SesMessageLog");
const SesEmailEvent    = require("../models/SesEmailEvent");
const { sendAdminBroadcastEmail } = require("../utils/emailUtils");

// Maps SES eventType → EmailLog.stats field name
const STATS_FIELD_MAP = {
  Send:       "sends",
  Delivery:   "deliveries",
  Open:       "opens",
  Click:      "clicks",
  Bounce:     "bounces",
  Complaint:  "complaints",
  Reject:     "rejections",
};

/**
 * Re-aggregate EmailLog.stats from SesEmailEvent records.
 * Called after back-filling emailLogId so stats reflect reality.
 * Deduplicates: counts one event per eventType per recipient.
 */
async function recalcEmailLogStats(emailLogId) {
  const events = await SesEmailEvent.find({ emailLogId }).select("recipientEmail eventType").lean();
  const seen   = new Set();
  const stats  = { sends: 0, deliveries: 0, opens: 0, clicks: 0, bounces: 0, complaints: 0, rejections: 0 };

  for (const e of events) {
    const key   = `${e.recipientEmail}||${e.eventType}`;
    const field = STATS_FIELD_MAP[e.eventType];
    if (field && !seen.has(key)) {
      seen.add(key);
      stats[field]++;
    }
  }

  await EmailLog.findByIdAndUpdate(emailLogId, { $set: { stats } });
  return stats;
}

/**
 * Replace all {{fieldName}} placeholders in `text` with values from `data`.
 * Keys matched case-insensitively. Unknown placeholders become empty strings.
 */
function applyDynamicFields(text, data = {}) {
  if (!text) return text;
  const normalised = {};
  Object.keys(data).forEach((k) => { normalised[k.toLowerCase()] = data[k]; });
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const val = normalised[key.toLowerCase()];
    if (val === undefined || val === null) return "";
    return String(val).trim();
  });
}

/**
 * Finalize a batch job when all batches are done.
 * Sets final status (completed/failed) and creates EmailLog.
 * Called from BOTH the daily cap early return AND the normal step 4 path
 * so jobs are never left stuck as "in_progress" regardless of how a batch ends.
 *
 * Guards against double-execution:
 *   - Returns early if job not found, already finalized, or not all batches done.
 *   - Checks for existing EmailLog to prevent duplicate creation.
 */
async function finalizeBatchJobIfComplete(jobId) {
  const job = await EmailBatchJob.findOne({ jobId });
  if (!job) return;
  // Already finalized — nothing to do
  if (!["pending", "in_progress"].includes(job.status)) return;
  // Not all batches done yet
  if (job.completedBatches < job.totalBatches) return;

  const finalStatus = job.failedBatches === job.totalBatches ? "failed" : "completed";
  await EmailBatchJob.findOneAndUpdate({ jobId }, { status: finalStatus });
  console.log(`[EmailBatch] ✅ Job ${jobId} finalized → ${finalStatus} (via finalizeBatchJobIfComplete)`);

  // EmailLog is best-effort — failure must NOT affect the batch result
  try {
    const actualSentCount = job.batches.reduce(
      (sum, b) => sum + (b.succeededCount || 0), 0
    );

    // Atomic upsert guard against duplicate EmailLog.
    // findOneAndUpdate with upsert:true + new:false returns:
    //   null     → document was just inserted (we own the creation)
    //   existing → document already existed (another finalization beat us — skip)
    // This is race-condition-proof: MongoDB's upsert is atomic so only one
    // concurrent call can "win" the insert even if both run simultaneously.
    const existing = await EmailLog.findOneAndUpdate(
      { batchJobId: jobId },
      {
        $setOnInsert: {
          subject:        job.subject,
          title:          job.title || "",
          body:           job.body,
          target:         "batch",
          recipientCount: actualSentCount,
          recipients:     job.batches.flatMap((b) =>
            b.recipients.map((r) => ({ email: r.email, name: r.name || "", userId: null }))
          ),
          fromEmail:        job.fromEmail || "noreply@voycell.com",
          fromName:         job.fromName  || "VOYCELL",
          createdBy:        job.createdBy,
          batchJobId:       jobId,
          scheduledStartAt: job.scheduledStartAt || null,
          batchSize:        job.batchSize,
          intervalValue:    job.intervalValue,
          intervalUnit:     job.intervalUnit,
          intervalSeconds:  job.intervalSeconds,
          totalBatches:     job.totalBatches,
        },
      },
      { upsert: true, new: false }
    );

    if (existing !== null) {
      console.log(`[EmailBatch] EmailLog already existed for job ${jobId} — skipping back-fill`);
      return;
    }

    // Fetch the newly inserted document to get its _id
    const emailLog = await EmailLog.findOne({ batchJobId: jobId }).lean();
    if (!emailLog) return;

    // Back-fill emailLogId on SesMessageLog
    await SesMessageLog.updateMany(
      { batchJobId: jobId, emailLogId: null },
      { $set: { emailLogId: emailLog._id } }
    ).catch((err) => console.error("[SesMessageLog] Back-fill emailLogId failed:", err.message));

    // Back-fill emailLogId on SesEmailEvent (events saved while job was running)
    await SesEmailEvent.updateMany(
      { batchJobId: jobId, emailLogId: null },
      { $set: { emailLogId: emailLog._id } }
    ).catch((err) => console.error("[SesEmailEvent] Back-fill by batchJobId failed:", err.message));

    // Back-fill orphaned events (batchJobId null — arrived before SesMessageLog was written)
    const sesLogs = await SesMessageLog.find({ batchJobId: jobId }).select("sesMessageId").lean();
    const sesMessageIds = sesLogs.map((s) => s.sesMessageId);
    if (sesMessageIds.length) {
      await SesEmailEvent.updateMany(
        { sesMessageId: { $in: sesMessageIds }, emailLogId: null },
        { $set: { emailLogId: emailLog._id, batchJobId: jobId } }
      ).catch((err) => console.error("[SesEmailEvent] Back-fill orphaned events failed:", err.message));
    }

    // Re-aggregate stats from actual events
    recalcEmailLogStats(emailLog._id)
      .then((stats) => console.log(`[EmailBatch] ✅ EmailLog stats recalculated for job ${jobId}:`, stats))
      .catch((err) => console.error("[EmailBatch] Stats recalc failed:", err.message));

  } catch (logErr) {
    console.error(`[EmailBatch] ⚠️ EmailLog create failed for job ${jobId}:`, logErr.message);
  }
}

/**
 * Called by the Lambda handler when event.type === "SEND_EMAIL_BATCH".
 * Sends all emails in one batch and updates the job status.
 */
const sendEmailBatchService = async ({ jobId, batchIndex }) => {
  const job = await EmailBatchJob.findOne({ jobId });
  if (!job) {
    console.error(`[EmailBatch] Job not found: ${jobId}`);
    return;
  }

  const batch = job.batches[batchIndex];
  if (!batch) {
    console.error(`[EmailBatch] Batch ${batchIndex} not found in job ${jobId}`);
    return;
  }

  if (batch.status === "sent") {
    console.log(`[EmailBatch] Batch ${batchIndex} already sent — skipping`);
    return;
  }

  console.log(`[EmailBatch] 📧 Sending batch ${batchIndex + 1}/${job.totalBatches} for job ${jobId} (${batch.recipients.length} emails)`);

  // ── Step 1: Mark job as in_progress on first batch ───────────────────────
  if (job.status === "pending") {
    await EmailBatchJob.findOneAndUpdate({ jobId }, { status: "in_progress" });
  }

  // ── Step 2: Check daily cap at fire time ─────────────────────────────────
  const now     = new Date();
  const day1Ago = new Date(now - 24 * 60 * 60 * 1000);

  const config = await EmailBatchConfig.findOne({ key: "global" }).lean();

  const [dailyAgg] = await Promise.all([
    EmailLog.aggregate([{ $match: { createdAt: { $gte: day1Ago } } }, { $group: { _id: null, total: { $sum: "$recipientCount" } } }]),
  ]);
  const completedEmailLogCount = dailyAgg[0]?.total ?? 0;

  const inProgressJobs = await EmailBatchJob.find({
    status: "in_progress",
    updatedAt: { $gte: day1Ago },
  }).select("batches").lean();

  let inProgressSentCount = 0;
  for (const j of inProgressJobs) {
    for (const b of (j.batches || [])) {
      if (b.status === "sent" || b.status === "partial") {
        inProgressSentCount += (b.succeededCount ?? b.recipients?.length ?? 0);
      }
    }
  }

  const dailyUsed = completedEmailLogCount + inProgressSentCount;
  const dailyCap  = config?.dailyCap   ?? Infinity;
  const canSend   = Math.max(0, dailyCap - dailyUsed);

  console.log(`[EmailBatch] Daily cap check — EmailLog: ${completedEmailLogCount}, in-progress sent: ${inProgressSentCount}, total used: ${dailyUsed}/${dailyCap}, canSend: ${canSend}`);

  if (canSend <= 0) {
    console.log(`[EmailBatch] 🚫 Batch ${batchIndex} of job ${jobId} skipped — daily cap reached (${dailyUsed}/${dailyCap})`);
    await EmailBatchJob.findOneAndUpdate(
      { jobId },
      {
        [`batches.${batchIndex}.status`]: "failed",
        [`batches.${batchIndex}.error`]:  `Daily cap reached (${dailyUsed}/${dailyCap})`,
        $inc: { completedBatches: 1, failedBatches: 1 },
      }
    );
    // FIX: check if this was the last batch — finalize job if so
    await finalizeBatchJobIfComplete(jobId);
    return;
  }

  // Only send as many as the daily cap allows within this batch
  const recipientsToSend = batch.recipients.slice(0, canSend);
  if (recipientsToSend.length < batch.recipients.length) {
    console.log(`[EmailBatch] ⚠️  Batch ${batchIndex}: daily cap allows ${canSend}, batch has ${batch.recipients.length} — sending ${recipientsToSend.length}`);
  }

  // ── Step 3: Send emails ───────────────────────────────────────────────────
  let failed = 0;
  let succeeded = 0;
  let sendError = null;

  try {
    // Decode base64 attachments back to Buffers for nodemailer
    const attachments = (job.attachments || []).map((a) => ({
      filename:    a.filename,
      contentType: a.contentType,
      content:     Buffer.from(a.content || "", "base64"),
    }));

    console.log(`[EmailBatch] 📧 Sending batch ${batchIndex} — replyTo: "${job.replyTo || "not set"}", fromEmail: "${job.fromEmail || "not set"}"`);

    const results = await Promise.allSettled(
      recipientsToSend.map((r) => {
        const recipientData   = r.data || {};
        const personalSubject = applyDynamicFields(job.subject, recipientData);
        const personalTitle   = applyDynamicFields(job.title,   recipientData);
        const personalBody    = applyDynamicFields(job.body,    recipientData);
        return sendAdminBroadcastEmail({
          to:          r.email,
          subject:     personalSubject,
          title:       personalTitle,
          body:        personalBody,
          fromEmail:   job.fromEmail,
          fromName:    job.fromName,
          replyTo:     job.replyTo,
          attachments: attachments.length ? attachments : undefined,
        });
      })
    );

    failed    = results.filter((r) => r.status === "rejected").length;
    succeeded = results.length - failed;

    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[EmailBatch] ❌ Failed to send to ${recipientsToSend[i]?.email}:`, r.reason?.message || r.reason);
      }
    });

    // FIX 2A: await SesMessageLog.insertMany so Delivery events always find
    // the record within the webhook's retry window — prevents Delivered=0 bug.
    const sesLogDocs = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value?.sesMessageId) {
        sesLogDocs.push({
          sesMessageId:   r.value.sesMessageId,
          emailLogId:     null,
          batchJobId:     jobId,
          recipientEmail: recipientsToSend[i]?.email || "",
          sentAt:         new Date(),
        });
      }
    });
    if (sesLogDocs.length) {
      await SesMessageLog.insertMany(sesLogDocs, { ordered: false }).catch((err) =>
        console.error("[SesMessageLog] Insert error (batch):", err.message)
      );
    }
  } catch (err) {
    sendError = err.message;
    failed    = batch.recipients.length;
    console.error(`[EmailBatch] ❌ Fatal send error in batch ${batchIndex} of job ${jobId}:`, err.message);
  }

  console.log(`[EmailBatch] Batch ${batchIndex}: ${succeeded} sent, ${failed} failed`);

  // ── Step 4: Update job status ─────────────────────────────────────────────
  try {
    const batchStatus = sendError || failed === recipientsToSend.length
      ? "failed"
      : failed > 0
        ? "partial"
        : "sent";

    const update = {
      [`batches.${batchIndex}.status`]:         batchStatus,
      [`batches.${batchIndex}.sentAt`]:          new Date(),
      [`batches.${batchIndex}.succeededCount`]:  succeeded,
      [`batches.${batchIndex}.failedCount`]:     failed,
      ...(sendError && { [`batches.${batchIndex}.error`]: sendError }),
      $inc: {
        completedBatches: 1,
        failedBatches:    batchStatus === "failed" ? 1 : 0,
      },
    };

    const updated = await EmailBatchJob.findOneAndUpdate({ jobId }, update, { new: true });

    // ── Step 5: On last batch, finalize + write EmailLog + send copyTo ──────
    if (updated.completedBatches >= updated.totalBatches) {
      const finalStatus = updated.failedBatches === updated.totalBatches ? "failed" : "completed";
      await EmailBatchJob.findOneAndUpdate({ jobId }, { status: finalStatus });
      console.log(`[EmailBatch] ✅ Job ${jobId} ${finalStatus} — ${job.totalRecipients} total recipients`);

      // Send silent copy to monitoring address (fire-and-forget, best-effort)
      if (job.copyTo) {
        console.log(`[CopyTo] Sending silent copy to ${job.copyTo}`);
        sendAdminBroadcastEmail({
          to:        job.copyTo,
          subject:   job.subject,
          title:     job.title,
          body:      job.body,
          fromEmail: job.fromEmail,
          fromName:  job.fromName,
          replyTo:   job.replyTo,
        })
          .then(() => console.log(`[CopyTo] ✅ Silent copy delivered to ${job.copyTo}`))
          .catch((err) => console.error(`[CopyTo] ❌ Failed:`, err.message));
      }

      // EmailLog is best-effort — failure here must NOT affect the batch result
      try {
        // Use `updated.batches` (fresh from DB) not `job.batches` (stale)
        const actualSentCount = updated.batches.reduce(
          (sum, b) => sum + (b.succeededCount || 0), 0
        );

        // Atomic upsert — same race-condition guard as in finalizeBatchJobIfComplete.
        // new:false → returns null if just inserted (we own it), returns existing doc if
        // another concurrent finalization already created it (skip back-fill).
        const existingBeforeInsert = await EmailLog.findOneAndUpdate(
          { batchJobId: jobId },
          {
            $setOnInsert: {
              subject:        job.subject,
              title:          job.title || "",
              body:           job.body,
              target:         "batch",
              recipientCount: actualSentCount,
              recipients:     job.batches.flatMap((b) =>
                b.recipients.map((r) => ({ email: r.email, name: r.name || "", userId: null }))
              ),
              fromEmail:        job.fromEmail || "noreply@voycell.com",
              fromName:         job.fromName  || "VOYCELL",
              createdBy:        job.createdBy,
              batchJobId:       jobId,
              scheduledStartAt: job.scheduledStartAt || null,
              batchSize:        job.batchSize,
              intervalValue:    job.intervalValue,
              intervalUnit:     job.intervalUnit,
              intervalSeconds:  job.intervalSeconds,
              totalBatches:     job.totalBatches,
            },
          },
          { upsert: true, new: false }
        );

        if (existingBeforeInsert !== null) {
          console.log(`[EmailBatch] EmailLog already existed for job ${jobId} — skipping back-fill`);
          return;
        }

        const emailLog = await EmailLog.findOne({ batchJobId: jobId }).lean();
        if (!emailLog) return;

        // Back-fill emailLogId on SesMessageLog
        await SesMessageLog.updateMany(
          { batchJobId: jobId, emailLogId: null },
          { $set: { emailLogId: emailLog._id } }
        ).catch((err) => console.error("[SesMessageLog] Back-fill emailLogId failed:", err.message));

        // Back-fill emailLogId on SesEmailEvent
        await SesEmailEvent.updateMany(
          { batchJobId: jobId, emailLogId: null },
          { $set: { emailLogId: emailLog._id } }
        ).catch((err) => console.error("[SesEmailEvent] Back-fill by batchJobId failed:", err.message));

        // Back-fill orphaned events (batchJobId: null)
        const sesLogs = await SesMessageLog.find({ batchJobId: jobId })
          .select("sesMessageId").lean();
        const sesMessageIds = sesLogs.map((s) => s.sesMessageId);
        if (sesMessageIds.length) {
          await SesEmailEvent.updateMany(
            { sesMessageId: { $in: sesMessageIds }, emailLogId: null },
            { $set: { emailLogId: emailLog._id, batchJobId: jobId } }
          ).catch((err) => console.error("[SesEmailEvent] Back-fill orphaned events failed:", err.message));
        }

        recalcEmailLogStats(emailLog._id)
          .then((stats) => console.log(`[EmailBatch] ✅ EmailLog stats recalculated for job ${jobId}:`, stats))
          .catch((err) => console.error("[EmailBatch] Stats recalc failed:", err.message));
      } catch (logErr) {
        console.error(`[EmailBatch] ⚠️ EmailLog create failed (emails were already sent):`, logErr.message);
      }
    }
  } catch (updateErr) {
    console.error(`[EmailBatch] ⚠️ Job status update failed for ${jobId} batch ${batchIndex}:`, updateErr.message);
  }
};

module.exports = { sendEmailBatchService, finalizeBatchJobIfComplete };
