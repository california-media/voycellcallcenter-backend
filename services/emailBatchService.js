const EmailBatchJob    = require("../models/EmailBatchJob");
const EmailLog         = require("../models/EmailLog");
const EmailBatchConfig = require("../models/EmailBatchConfig");
const { sendAdminBroadcastEmail } = require("../utils/emailUtils");

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
  const now     = new Date();
  const day1Ago = new Date(now - 24 * 60 * 60 * 1000);

  const config = await EmailBatchConfig.findOne({ key: "global" }).lean();
  const [dailyAgg] = await Promise.all([
    EmailLog.aggregate([{ $match: { createdAt: { $gte: day1Ago } } }, { $group: { _id: null, total: { $sum: "$recipientCount" } } }]),
  ]);
  const dailyUsed = dailyAgg[0]?.total ?? 0;
  const dailyCap  = config?.dailyCap   ?? Infinity;
  const canSend   = Math.max(0, dailyCap - dailyUsed);

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
  } catch (err) {
    sendError = err.message;
    failed    = batch.recipients.length;
    console.error(`[EmailBatch] ❌ Fatal send error in batch ${batchIndex} of job ${jobId}:`, err.message);
  }

  console.log(`[EmailBatch] Batch ${batchIndex}: ${succeeded} sent, ${failed} failed`);

  // ── Step 3: Update job status — separate try/catch so logging failures never
  //           affect the "emails were sent" status ─────────────────────────────
  try {
    const batchStatus = (sendError || failed === batch.recipients.length) ? "failed" : "sent";

    const update = {
      [`batches.${batchIndex}.status`]: batchStatus,
      [`batches.${batchIndex}.sentAt`]: new Date(),
      ...(sendError && { [`batches.${batchIndex}.error`]: sendError }),
      $inc: {
        completedBatches: 1,
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
        await EmailLog.create({
          subject:        job.subject,
          title:          job.title || "",
          body:           job.body,
          target:         "batch",
          recipientCount: job.totalRecipients,
          recipients:     job.batches.flatMap((b) =>
            b.recipients.map((r) => ({ email: r.email, name: r.name || "", userId: null }))
          ),
          fromEmail:  job.fromEmail || "noreply@voycell.com",
          fromName:   job.fromName  || "VOYCELL",
          createdBy:  job.createdBy,
        });
      } catch (logErr) {
        console.error(`[EmailBatch] ⚠️ EmailLog create failed (emails were already sent):`, logErr.message);
      }
    }
  } catch (updateErr) {
    console.error(`[EmailBatch] ⚠️ Job status update failed for ${jobId} batch ${batchIndex}:`, updateErr.message);
  }
};

module.exports = { sendEmailBatchService };
