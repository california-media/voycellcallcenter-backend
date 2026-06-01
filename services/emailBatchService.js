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
  // Two-source accounting (no double-counting):
  //   1. EmailLog.aggregate  → completed jobs (EmailLog written at job completion)
  //   2. in_progress jobs    → batches sent but EmailLog not yet written
  // "completed" is intentionally excluded from source 2 — those emails are
  // already in source 1. Including them would halve the effective daily cap.
  const now     = new Date();
  const day1Ago = new Date(now - 24 * 60 * 60 * 1000);

  const config = await EmailBatchConfig.findOne({ key: "global" }).lean();

  // Emails from fully-completed jobs (written to EmailLog)
  const [dailyAgg] = await Promise.all([
    EmailLog.aggregate([{ $match: { createdAt: { $gte: day1Ago } } }, { $group: { _id: null, total: { $sum: "$recipientCount" } } }]),
  ]);
  const completedEmailLogCount = dailyAgg[0]?.total ?? 0;

  // Emails already sent by in-progress batch jobs TODAY (not yet written to EmailLog).
  // Only "in_progress" — "completed" jobs already have their EmailLog written and are
  // fully counted by the EmailLog.aggregate above. Including "completed" here would
  // double-count those emails, effectively halving the daily cap.
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
    return;
  }

  // Only send as many as the daily cap allows within this batch
  const recipientsToSend = batch.recipients.slice(0, canSend);
  if (recipientsToSend.length < batch.recipients.length) {
    console.log(`[EmailBatch] ⚠️  Batch ${batchIndex}: daily cap allows ${canSend}, batch has ${batch.recipients.length} — sending ${recipientsToSend.length}`);
  }

  // ── Step 3: Send emails — this is the critical step, isolated in its own try/catch ──
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
        // Apply per-recipient dynamic field substitution
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

    // Log individual failures for debugging
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[EmailBatch] ❌ Failed to send to ${recipientsToSend[i]?.email}:`, r.reason?.message || r.reason);
      }
    });

    // Persist SES messageId → batchJob + recipient mapping for tracking
    const sesLogDocs = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value?.sesMessageId) {
        sesLogDocs.push({
          sesMessageId:   r.value.sesMessageId,
          emailLogId:     null,      // back-filled when EmailLog is created at job completion
          batchJobId:     jobId,
          recipientEmail: recipientsToSend[i]?.email || "",
          sentAt:         new Date(),
        });
      }
    });
    if (sesLogDocs.length) {
      SesMessageLog.insertMany(sesLogDocs, { ordered: false }).catch((err) =>
        console.error("[SesMessageLog] Insert error (batch):", err.message)
      );
    }
  } catch (err) {
    sendError = err.message;
    failed    = batch.recipients.length;
    console.error(`[EmailBatch] ❌ Fatal send error in batch ${batchIndex} of job ${jobId}:`, err.message);
  }

  console.log(`[EmailBatch] Batch ${batchIndex}: ${succeeded} sent, ${failed} failed`);

  // ── Step 3: Update job status — separate try/catch so logging failures never
  //           affect the "emails were sent" status ─────────────────────────────
  try {
    // "failed"  = every single email in the batch failed (or fatal error)
    // "partial" = some succeeded, some failed — visible in UI, never hidden
    // "sent"    = all emails succeeded
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
        // Only count as a failed batch if EVERY email failed — partial is not a full failure
        failedBatches:    batchStatus === "failed" ? 1 : 0,
      },
    };

    const updated = await EmailBatchJob.findOneAndUpdate({ jobId }, update, { new: true });

    // ── Step 4: On last batch, finalize job + write EmailLog ────────────────
    if (updated.completedBatches >= updated.totalBatches) {
      const finalStatus = updated.failedBatches === updated.totalBatches ? "failed" : "completed";
      await EmailBatchJob.findOneAndUpdate({ jobId }, { status: finalStatus });
      console.log(`[EmailBatch] ✅ Job ${jobId} ${finalStatus} — ${job.totalRecipients} total recipients`);

      // Send silent copy to the monitoring address
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
        // Use `updated.batches` (fresh from DB) not `job.batches` (stale, loaded at
        // batch start). Previous batches updated their succeededCount via findOneAndUpdate
        // which doesn't mutate the in-memory `job` object.
        const actualSentCount = updated.batches.reduce(
          (sum, b) => sum + (b.succeededCount || 0), 0
        );
        const emailLog = await EmailLog.create({
          subject:        job.subject,
          title:          job.title || "",
          body:           job.body,
          target:         "batch",
          recipientCount: actualSentCount || job.totalRecipients,
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
        });

        // ── Back-fill emailLogId on SesMessageLog ────────────────────────────
        await SesMessageLog.updateMany(
          { batchJobId: jobId, emailLogId: null },
          { $set: { emailLogId: emailLog._id } }
        ).catch((err) => console.error("[SesMessageLog] Back-fill emailLogId failed:", err.message));

        // ── Back-fill emailLogId on SesEmailEvent ─────────────────────────────
        // Events that arrived while the job was running were saved with
        // emailLogId: null because EmailLog didn't exist yet. Now that it does,
        // link them so the history table and per-recipient view show correct data.
        // Step 1: fix events linked by batchJobId (most events arrive after SesMessageLog is written)
        await SesEmailEvent.updateMany(
          { batchJobId: jobId, emailLogId: null },
          { $set: { emailLogId: emailLog._id } }
        ).catch((err) => console.error("[SesEmailEvent] Back-fill by batchJobId failed:", err.message));

        // Step 2: fix orphaned events (batchJobId: null — arrived before SesMessageLog was written)
        // Look up via sesMessageId → SesMessageLog to find the ones belonging to this job
        const sesLogs = await SesMessageLog.find({ batchJobId: jobId })
          .select("sesMessageId").lean();
        const sesMessageIds = sesLogs.map((s) => s.sesMessageId);
        if (sesMessageIds.length) {
          await SesEmailEvent.updateMany(
            { sesMessageId: { $in: sesMessageIds }, emailLogId: null },
            { $set: { emailLogId: emailLog._id, batchJobId: jobId } }
          ).catch((err) => console.error("[SesEmailEvent] Back-fill orphaned events failed:", err.message));
        }

        // ── Re-aggregate EmailLog.stats from actual events ────────────────────
        // Stats were never incremented via webhook because emailLogId was null
        // when events arrived. Now recalculate from the complete event set.
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

module.exports = { sendEmailBatchService };
