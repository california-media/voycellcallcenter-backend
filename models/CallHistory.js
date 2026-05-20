const mongoose = require("mongoose");

/**
 * Parse "MM/DD/YYYY HH:mm:ss" string into a UTC Date.
 * Treats the string as UTC — same behaviour as MongoDB $dateFromString without
 * a timezone parameter, so all existing query comparisons stay consistent.
 */
function parseStartTime(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min, ss] = m;
  return new Date(Date.UTC(+yyyy, +mm - 1, +dd, +hh, +min, +ss));
}

const callHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    extensionNumber: {
      type: String,
      required: true,
    },
    extensionPhone: { type: String, default: null },

    // Yeastar CDR fields
    yeastarId: { type: String, required: true, unique: true }, // cdr.id
    call_from: String,
    call_to: String,
    talk_time: Number,
    ring_time: Number,
    duration: Number,
    direction: String,
    status: String,
    start_time: { type: String },
    end_time: { type: String },
    record_file: String,
    disposition_code: String,
    trunk: String,

    // Billing — populated only for outbound calls from a purchased DID number
    charges:     { type: Number, default: null }, // USD charged for this call
    ratePerMin:  { type: Number, default: null }, // $/min rate used
    billedFrom:  { type: String, default: null }, // purchased DID that triggered billing

    // ── Indexed Date version of start_time ────────────────────────────────────
    // Allows fast range queries instead of $expr + $dateFromString (full collection scan).
    // Auto-populated on save from start_time. Existing records are backfilled by
    // the migration that runs once at server startup (see getYeasterCallHistoryController).
    startTimeParsed: { type: Date, default: null },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Compound index on userId + startTimeParsed: covers all dashboard date-range
// queries with a single fast index seek instead of a full collection scan.
callHistorySchema.index({ userId: 1, startTimeParsed: 1 });
// Standalone index so queries filtering only by userId (e.g. count queries) are fast too.
callHistorySchema.index({ userId: 1 });

// ── Pre-save hook ─────────────────────────────────────────────────────────────
// Automatically populates startTimeParsed whenever a record is created or updated.
callHistorySchema.pre("save", function (next) {
  if (this.start_time && !this.startTimeParsed) {
    this.startTimeParsed = parseStartTime(this.start_time);
  }
  next();
});

// Also runs for Model.create() bulk inserts via insertMany
callHistorySchema.pre("insertMany", function (next, docs) {
  docs.forEach((doc) => {
    if (doc.start_time && !doc.startTimeParsed) {
      doc.startTimeParsed = parseStartTime(doc.start_time);
    }
  });
  next();
});

const CallHistory = mongoose.model("CallHistory", callHistorySchema);

// ── One-time background migration ─────────────────────────────────────────────
// Backfills startTimeParsed for all existing records that don't have it yet.
// Runs once asynchronously at module load — does NOT block server startup.
// Safe to run multiple times (only touches docs where startTimeParsed is null).
(async () => {
  try {
    // Small delay so the DB connection is ready before we start bulk-writing
    await new Promise((r) => setTimeout(r, 5000));

    const total = await CallHistory.countDocuments({ startTimeParsed: null });
    if (total === 0) return; // already migrated

    console.log(`[CallHistory migration] Backfilling startTimeParsed for ${total} records…`);

    const BATCH = 500;
    let processed = 0;

    while (true) {
      const docs = await CallHistory.find({ startTimeParsed: null })
        .select("_id start_time")
        .limit(BATCH)
        .lean();

      if (!docs.length) break;

      const ops = docs
        .map((d) => {
          const parsed = parseStartTime(d.start_time);
          if (!parsed) return null;
          return {
            updateOne: {
              filter: { _id: d._id },
              update: { $set: { startTimeParsed: parsed } },
            },
          };
        })
        .filter(Boolean);

      if (ops.length) await CallHistory.bulkWrite(ops, { ordered: false });

      processed += docs.length;
      console.log(`[CallHistory migration] ${processed}/${total} records migrated`);
    }

    console.log(`[CallHistory migration] ✅ Done — ${processed} records backfilled`);
  } catch (err) {
    console.error("[CallHistory migration] ❌ Error:", err.message);
  }
})();

module.exports = CallHistory;
