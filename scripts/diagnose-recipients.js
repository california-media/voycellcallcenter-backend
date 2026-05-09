/**
 * diagnose-recipients.js
 *
 * Checks the database for specific recipient emails and shows exactly
 * what SesEmailEvent, SesMessageLog, and EmailLog records exist for them.
 *
 * Run: node scripts/diagnose-recipients.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

const CHECK_EMAILS = [
  "ajay@ajaydhaka.in",
  "shyam@rhemproperties.com",
  "info@goldenservices.ae",
  "bertie@hausandhaus.com",
  "maeve@hausandhaus.com",
  "ahmad.khalifa@propertylegacy.com",
  "admin@lcredubai.com",
  "hussain@grosvenor-re.com",
  "ramsha@aquaproperties.com",
  "admin@bitsproperties.ae",
  "rajesh@dnl.ae",
  "ankita.havelia10@gmail.com",
  "varyvoday@gmail.com",
  "olivia.allen969@hotmail.com",
  "ldd0423@gmail.com",
  "gss122@hotmail.com",
  "Shoebmattathi@gmail.com",
  "miansam349@gmail.com",
  "abdallah.shaheen558@gmail.com",
  "sbalooshi96@gmail.com",  // this one shows ✓ — useful for comparison
];

// ── Minimal schemas ───────────────────────────────────────────────────────────
const SesEmailEventSchema = new mongoose.Schema({
  sesMessageId:   String,
  emailLogId:     { type: mongoose.Schema.Types.ObjectId, default: null },
  batchJobId:     { type: String, default: null },
  eventType:      String,
  recipientEmail: String,
}, { timestamps: true });

const SesMessageLogSchema = new mongoose.Schema({
  sesMessageId:   String,
  emailLogId:     { type: mongoose.Schema.Types.ObjectId, default: null },
  batchJobId:     { type: String, default: null },
  recipientEmail: String,
});

const EmailLogSchema = new mongoose.Schema({
  subject:    String,
  recipients: [{ email: String, name: String }],
  stats:      mongoose.Schema.Types.Mixed,
}, { timestamps: true });

const SesEmailEvent = mongoose.model("SesEmailEvent", SesEmailEventSchema);
const SesMessageLog = mongoose.model("SesMessageLog", SesMessageLogSchema);
const EmailLog      = mongoose.model("EmailLog",      EmailLogSchema);

async function run() {
  await mongoose.connect(process.env.MONGO_URL, { serverSelectionTimeoutMS: 10000 });
  console.log("✅  Connected\n");

  // Case-insensitive search so Shoebmattathi@gmail.com etc. are found regardless of casing
  const emailRegexes = CHECK_EMAILS.map(e => new RegExp(`^${e}$`, "i"));

  for (const email of CHECK_EMAILS) {
    const regex = new RegExp(`^${email}$`, "i");
    console.log(`\n${"─".repeat(60)}`);
    console.log(`📧  ${email}`);
    console.log(`${"─".repeat(60)}`);

    // 1. SesEmailEvent records
    const events = await SesEmailEvent.find({ recipientEmail: regex })
      .select("sesMessageId emailLogId batchJobId eventType createdAt")
      .sort({ createdAt: 1 })
      .lean();

    if (events.length === 0) {
      console.log("  ❌  NO SesEmailEvent records found");
    } else {
      for (const e of events) {
        const emailLogStr = e.emailLogId ? e.emailLogId.toString() : "NULL ⚠️";
        const batchStr    = e.batchJobId || "NULL ⚠️";
        console.log(`  Event: ${e.eventType.padEnd(10)} | emailLogId: ${emailLogStr} | batchJobId: ${batchStr.slice(0,8)}...`);
      }
    }

    // 2. SesMessageLog records
    const msgLogs = await SesMessageLog.find({
      $or: [
        { recipientEmail: regex },
        // Also find by sesMessageId from events above
        ...(events.length ? [{ sesMessageId: { $in: events.map(e => e.sesMessageId) } }] : [])
      ]
    }).select("sesMessageId emailLogId batchJobId recipientEmail").lean();

    if (msgLogs.length === 0) {
      console.log("  ❌  NO SesMessageLog records found");
    } else {
      for (const m of msgLogs) {
        const emailLogStr = m.emailLogId ? m.emailLogId.toString() : "NULL ⚠️";
        console.log(`  MsgLog: emailLogId: ${emailLogStr} | batchJobId: ${(m.batchJobId || "NULL").slice(0,8)}...`);
      }
    }

    // 3. Is this email in any EmailLog.recipients?
    const emailLog = await EmailLog.findOne(
      { "recipients.email": regex },
      { subject: 1, "recipients.$": 1, stats: 1 }
    ).lean();

    if (!emailLog) {
      console.log("  ❌  NOT FOUND in any EmailLog.recipients");
    } else {
      const recipientInLog = emailLog.recipients?.[0];
      console.log(`  EmailLog: "${emailLog.subject?.slice(0,40)}" | recipient email stored as: "${recipientInLog?.email}"`);

      // Check if email case matches SesEmailEvent.recipientEmail exactly
      const storedEmail     = recipientInLog?.email || "";
      const eventEmail      = events[0]?.recipientEmail || "";
      const caseMismatch    = storedEmail !== eventEmail && storedEmail.toLowerCase() === eventEmail.toLowerCase();
      if (caseMismatch) {
        console.log(`  ⚠️  CASE MISMATCH: EmailLog stores "${storedEmail}" but SesEmailEvent has "${eventEmail}"`);
        console.log(`     → recipientEventMap["${storedEmail}"] won't match events keyed by "${eventEmail}"`);
      } else if (storedEmail === eventEmail) {
        console.log(`  ✅  Email case matches — lookup will work`);
      }
    }
  }

  // ── Summary: events with emailLogId=null ──────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  const nullEmailLogId = await SesEmailEvent.countDocuments({
    recipientEmail: { $in: CHECK_EMAILS.map(e => new RegExp(`^${e}$`, "i")) },
    emailLogId: null,
  });
  console.log(`\n📊  Events with emailLogId=null for checked emails: ${nullEmailLogId}`);

  // ── Check sbalooshi vs others: what's different? ──────────────────────────
  console.log(`\n🔍  Comparing sbalooshi96@gmail.com (shows ✓) vs others:`);
  const sbalooshiEvents = await SesEmailEvent.find({ recipientEmail: /^sbalooshi96@gmail\.com$/i })
    .select("sesMessageId emailLogId batchJobId eventType").lean();
  const sbalooshiMsgLog = sbalooshiEvents.length
    ? await SesMessageLog.findOne({ sesMessageId: sbalooshiEvents[0].sesMessageId })
        .select("emailLogId batchJobId").lean()
    : null;
  console.log(`  sbalooshi - SesEmailEvent.emailLogId: ${sbalooshiEvents[0]?.emailLogId || "null"}`);
  console.log(`  sbalooshi - SesMessageLog.emailLogId: ${sbalooshiMsgLog?.emailLogId || "null"}`);

  await mongoose.disconnect();
  console.log("\n✅  Done");
}

run().catch(err => { console.error("❌", err.message); process.exit(1); });
