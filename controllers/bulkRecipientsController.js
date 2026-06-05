const mongoose       = require("mongoose");
const EmailLog       = require("../models/EmailLog");
const EmailBatchJob  = require("../models/EmailBatchJob");
const SesEmailEvent  = require("../models/SesEmailEvent");
const SesMessageLog  = require("../models/SesMessageLog");

// ── POST /notifications/email-logs/bulk-recipients ────────────────────────────
// Fetches recipients across multiple EmailLog entries, applies a filter
// (opened / delivered / bounced / all), deduplicates by email, and returns
// a merged list ready to be pre-loaded into the compose form.
//
// Body: { logIds: string[], filter: "all" | "delivered" | "opened" | "bounced" }
//
// Dedup rule: if the same email appears in multiple campaigns, the recipient
// data (name, dynamic fields) from the MOST RECENT campaign wins.
exports.getBulkRecipients = async (req, res) => {
  try {
    const { logIds = [], filter = "all" } = req.body;

    if (!logIds.length) {
      return res.status(400).json({ status: "error", message: "logIds is required" });
    }

    const validFilters = ["all", "delivered", "opened", "bounced"];
    if (!validFilters.includes(filter)) {
      return res.status(400).json({ status: "error", message: `filter must be one of: ${validFilters.join(", ")}` });
    }

    // Fetch all logs (sorted oldest→newest so newer data wins in dedup)
    const logs = await EmailLog.find({ _id: { $in: logIds.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select("_id recipients createdAt batchJobId")
      .sort({ createdAt: 1 })
      .lean();

    if (!logs.length) {
      return res.status(404).json({ status: "error", message: "No logs found for the provided IDs" });
    }

    // ── Fetch full recipient data from EmailBatchJob ──────────────────────────
    // EmailLog.recipients only stores { email, name } — the full dynamic field
    // data (company, phone, etc.) is in EmailBatchJob.batches[].recipients[].data
    // Build map: email(lowercase) → data object from the batch job
    const batchJobIds = logs.map((l) => l.batchJobId).filter(Boolean);
    const emailDataMap = {}; // email → { ...original data fields from Excel }

    if (batchJobIds.length) {
      const batchJobs = await EmailBatchJob.find(
        { jobId: { $in: batchJobIds } },
        { "batches.recipients.email": 1, "batches.recipients.name": 1, "batches.recipients.data": 1 }
      ).lean();

      for (const job of batchJobs) {
        for (const batch of (job.batches || [])) {
          for (const r of (batch.recipients || [])) {
            const emailKey = (r.email || "").toLowerCase();
            if (!emailKey) continue;
            // Only store if the original had extra data fields beyond just email/name
            if (r.data && Object.keys(r.data).length > 0) {
              emailDataMap[emailKey] = r.data;
            }
          }
        }
      }
    }

    // ── Build SES event map ───────────────────────────────────────────────────
    const logObjectIds = logs.map((l) => l._id);

    const sesLogs = await SesMessageLog.find({ emailLogId: { $in: logObjectIds } })
      .select("sesMessageId emailLogId")
      .lean();
    const msgIdToLogId = {};
    sesLogs.forEach((sl) => {
      if (sl.sesMessageId) msgIdToLogId[sl.sesMessageId] = sl.emailLogId.toString();
    });
    const allSesIds = Object.keys(msgIdToLogId);

    const orConditions = [
      { emailLogId: { $in: logObjectIds } },
      ...(allSesIds.length ? [{ sesMessageId: { $in: allSesIds } }] : []),
    ];

    const eventsAgg = await SesEmailEvent.aggregate([
      { $match: { $or: orConditions } },
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: {
            emailLogId:   "$emailLogId",
            sesMessageId: "$sesMessageId",
            email:        { $toLower: { $ifNull: ["$recipientEmail", ""] } },
            eventType:    "$eventType",
          },
        },
      },
    ]);

    // eventFlags[logId][email] = { Delivery: bool, Open: bool, Bounce: bool }
    const eventFlags = {};
    for (const doc of eventsAgg) {
      const logId = doc._id.emailLogId
        ? doc._id.emailLogId.toString()
        : (msgIdToLogId[doc._id.sesMessageId] || null);
      if (!logId) continue;
      const email = doc._id.email;
      if (!email) continue;
      if (!eventFlags[logId]) eventFlags[logId] = {};
      if (!eventFlags[logId][email]) eventFlags[logId][email] = {};
      eventFlags[logId][email][doc._id.eventType] = true;
    }

    // ── Merge recipients across logs ──────────────────────────────────────────
    const recipientMap = {};

    for (const log of logs) {
      const logId = log._id.toString();
      const flags = eventFlags[logId] || {};

      for (const r of (log.recipients || [])) {
        const emailKey = (r.email || "").toLowerCase();
        if (!emailKey) continue;

        const rFlags = flags[emailKey] || {};

        // Apply filter
        if (filter === "delivered" && !rFlags.Delivery) continue;
        if (filter === "opened"    && !rFlags.Open)     continue;
        if (filter === "bounced"   && !rFlags.Bounce)   continue;
        // "all" excludes bounced — resending to confirmed-invalid addresses
        // raises SES bounce rate and risks account suspension (>10% threshold)
        if (filter === "all"       && rFlags.Bounce)    continue;

        // Get full data from batch job (has company, phone etc.)
        // Fall back to empty object if job data not available
        const originalData = emailDataMap[emailKey] || {};

        // Newer log overwrites older (loop is oldest→newest)
        recipientMap[emailKey] = {
          email: r.email,
          name:  r.name || "",
          // Only include original Excel dynamic fields — NOT email/name (those are
          // top-level properties, not placeholders needing detection)
          data: originalData,
        };
      }
    }

    const recipients = Object.values(recipientMap);

    // Derive dynamic field names from actual Excel data.
    // Include ALL keys including email — if the original campaign had an email
    // column the user may use {{email}} as a placeholder in their body.
    const fieldSet = new Set();
    for (const r of recipients) {
      Object.keys(r.data || {}).forEach((k) => {
        if (k) fieldSet.add(k);
      });
    }
    const dynamicFields = Array.from(fieldSet);

    res.json({
      status:         "success",
      filter,
      totalCampaigns: logs.length,
      recipients,
      recipientCount: recipients.length,
      dynamicFields,  // only actual Excel columns — never hardcoded name/email
    });
  } catch (err) {
    console.error("[BulkRecipients] Error:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
};
