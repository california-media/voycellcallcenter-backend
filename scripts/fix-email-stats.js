/**
 * fix-email-stats.js
 *
 * Standalone script — connects directly to MongoDB and fixes all orphaned
 * SesEmailEvent records and wrong EmailLog.stats.
 *
 * Run from the backend folder:
 *   node scripts/fix-email-stats.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

// ── Inline model definitions ──────────────────────────────────────────────────

const SesEmailEventSchema = new mongoose.Schema({
  sesMessageId:   String,
  emailLogId:     { type: mongoose.Schema.Types.ObjectId, default: null },
  batchJobId:     { type: String, default: null },
  eventType:      String,
  recipientEmail: String,
}, { timestamps: true });

const SesMessageLogSchema = new mongoose.Schema({
  sesMessageId: String,
  emailLogId:   { type: mongoose.Schema.Types.ObjectId, default: null },
  batchJobId:   { type: String, default: null },
});

const EmailLogSchema = new mongoose.Schema({
  subject:        String,
  recipientCount: Number,
  stats: {
    sends:       { type: Number, default: 0 },
    deliveries:  { type: Number, default: 0 },
    opens:       { type: Number, default: 0 },
    clicks:      { type: Number, default: 0 },
    bounces:     { type: Number, default: 0 },
    complaints:  { type: Number, default: 0 },
    rejections:  { type: Number, default: 0 },
  },
}, { timestamps: true });

const SesEmailEvent = mongoose.model("SesEmailEvent", SesEmailEventSchema);
const SesMessageLog = mongoose.model("SesMessageLog", SesMessageLogSchema);
const EmailLog      = mongoose.model("EmailLog",      EmailLogSchema);

// ── Stats field mapping ───────────────────────────────────────────────────────
const STATS_FIELD_MAP = {
  Send:             "sends",
  Delivery:         "deliveries",
  Open:             "opens",
  Click:            "clicks",
  Bounce:           "bounces",
  Complaint:        "complaints",
  Reject:           "rejections",
  RenderingFailure: "rejections",
};

// ── Helper: safely convert to ObjectId ───────────────────────────────────────
function toObjectId(val) {
  if (!val) return null;
  if (val instanceof mongoose.Types.ObjectId) return val;
  try { return new mongoose.Types.ObjectId(String(val)); } catch { return null; }
}

// ── Main migration ────────────────────────────────────────────────────────────
async function run() {
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) {
    console.error("❌  MONGO_URL not found in .env");
    process.exit(1);
  }

  console.log("🔌  Connecting to MongoDB…");
  await mongoose.connect(mongoUrl, { serverSelectionTimeoutMS: 10000 });
  console.log("✅  Connected.\n");

  // ── Step 1: Find all orphaned SesEmailEvent records ──────────────────────
  const orphaned = await SesEmailEvent.find({ emailLogId: null })
    .select("_id sesMessageId batchJobId eventType recipientEmail")
    .lean();

  console.log(`📋  Orphaned events (emailLogId = null): ${orphaned.length}`);

  if (orphaned.length === 0) {
    console.log("🎉  Nothing to link — checking if any EmailLogs still have wrong stats…\n");
  } else {
    // Group by sesMessageId
    const byMsgId = {};
    orphaned.forEach((e) => {
      if (!byMsgId[e.sesMessageId]) byMsgId[e.sesMessageId] = [];
      byMsgId[e.sesMessageId].push(e._id);
    });

    let linkedCount   = 0;
    let skippedCount  = 0;
    const affectedEmailLogIds = new Set();

    for (const [sesMessageId, eventIds] of Object.entries(byMsgId)) {
      const msgLog = await SesMessageLog.findOne({ sesMessageId })
        .select("emailLogId batchJobId").lean();

      if (!msgLog?.emailLogId) {
        skippedCount += eventIds.length;
        continue;
      }

      const oid = toObjectId(msgLog.emailLogId);
      if (!oid) { skippedCount += eventIds.length; continue; }

      await SesEmailEvent.updateMany(
        { _id: { $in: eventIds } },
        { $set: { emailLogId: oid, batchJobId: msgLog.batchJobId || null } }
      );

      affectedEmailLogIds.add(oid.toString());
      linkedCount += eventIds.length;
    }

    console.log(`🔗  Linked  : ${linkedCount} events`);
    console.log(`⏭️   Skipped : ${skippedCount} events (SesMessageLog.emailLogId still null — job incomplete or EmailLog missing)`);
    console.log(`📊  Affected EmailLogs: ${affectedEmailLogIds.size}\n`);

    // ── Step 2: Re-aggregate stats for affected EmailLogs ──────────────────
    for (const emailLogIdStr of affectedEmailLogIds) {
      const oid    = toObjectId(emailLogIdStr);
      const events = await SesEmailEvent.find({ emailLogId: oid })
        .select("recipientEmail eventType").lean();

      const seen  = new Set();
      const stats = { sends: 0, deliveries: 0, opens: 0, clicks: 0, bounces: 0, complaints: 0, rejections: 0 };

      for (const e of events) {
        const key   = `${e.recipientEmail}||${e.eventType}`;
        const field = STATS_FIELD_MAP[e.eventType];
        if (field && !seen.has(key)) { seen.add(key); stats[field]++; }
      }

      await EmailLog.findByIdAndUpdate(oid, { $set: { stats } });

      const log = await EmailLog.findById(oid).select("subject stats").lean();
      const allZero = Object.values(stats).every((v) => v === 0);

      if (allZero) {
        // Diagnostic: show what eventTypes exist for this EmailLog to help debug
        const evTypes = [...new Set(events.map((e) => e.eventType))];
        console.log(`  ⚠️   "${log?.subject?.slice(0, 40)}" — still 0 stats after fix`);
        console.log(`       Events found: ${events.length} | EventTypes in DB: [${evTypes.join(", ") || "none"}]`);
        if (events.length === 0) {
          console.log(`       ℹ️  No SesEmailEvent records exist for this EmailLog yet.`);
          console.log(`          This usually means the emails failed at SMTP level (before reaching SES),`);
          console.log(`          or this campaign's batch job never completed so EmailLog was never linked.`);
        }
      } else {
        console.log(`  ✅  "${log?.subject?.slice(0, 40)}"`, stats);
      }
    }
  }

  // ── Step 3: Check ALL EmailLogs with all-zero stats (not just affected ones) ──
  // This catches EmailLogs that were created correctly but whose SesEmailEvents
  // were linked before this script ran and their stats never got recalculated.
  console.log("\n🔍  Checking ALL EmailLogs with zero stats for linkable events…");

  const zeroStatLogs = await EmailLog.find({
    "stats.sends": 0,
    "stats.deliveries": 0,
    "stats.opens": 0,
  }).select("_id subject recipientCount").lean();

  console.log(`    Found ${zeroStatLogs.length} EmailLog(s) with all-zero stats`);

  let repairedFromExisting = 0;

  for (const log of zeroStatLogs) {
    const oid    = toObjectId(log._id);
    const events = await SesEmailEvent.find({ emailLogId: oid })
      .select("recipientEmail eventType").lean();

    if (events.length === 0) continue; // truly no events — skip

    const seen  = new Set();
    const stats = { sends: 0, deliveries: 0, opens: 0, clicks: 0, bounces: 0, complaints: 0, rejections: 0 };
    for (const e of events) {
      const key   = `${e.recipientEmail}||${e.eventType}`;
      const field = STATS_FIELD_MAP[e.eventType];
      if (field && !seen.has(key)) { seen.add(key); stats[field]++; }
    }

    const allZero = Object.values(stats).every((v) => v === 0);
    if (allZero) {
      const evTypes = [...new Set(events.map((e) => e.eventType))];
      console.log(`  ⚠️   "${log.subject?.slice(0, 40)}" has ${events.length} events but unknown types: [${evTypes.join(", ")}]`);
      continue;
    }

    await EmailLog.findByIdAndUpdate(oid, { $set: { stats } });
    console.log(`  ✅  Repaired "${log.subject?.slice(0, 40)}"`, stats);
    repairedFromExisting++;
  }

  if (repairedFromExisting === 0 && zeroStatLogs.length > 0) {
    console.log("    ℹ️  Remaining zero-stat logs have no SesEmailEvent records.");
    console.log("       These campaigns either had SMTP failures or are still in progress.");
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(60)}`);
  console.log("🎉  Done!");
  console.log(`${"─".repeat(60)}\n`);
  console.log("Refresh your Sent Email History table — stats should now be correct.");
  console.log("Run this script again after any stuck jobs complete to fix remaining entries.");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("❌  Script failed:", err.message);
  process.exit(1);
});
