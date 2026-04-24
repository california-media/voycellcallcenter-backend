/**
 * Automated database backup — uploads a ZIP to S3 every 2 hours.
 * Backups are stored under:   s3://{BUCKET}/backups/voycell-backup-{timestamp}.zip
 * Backups older than 7 days are deleted automatically after each run.
 */

const cron        = require("node-cron");
const archiver    = require("archiver");
const { PassThrough } = require("stream");
const mongoose    = require("mongoose");
const {
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { EJSON }  = require("bson");

// Reuse the existing S3 client — same credentials that work for WhatsApp media
const s3 = require("./s3");

const BUCKET            = process.env.AWS_BUCKET_NAME;
const BACKUP_PREFIX     = "backups/";
const RETENTION_DAYS    = 7;
const EXCLUDE_COLLECTIONS = ["apilogs", "useractivitys", "usersessions"];

// ── Core: build ZIP in memory + upload ────────────────────────────────────────
const runBackup = async () => {
  if (!BUCKET) {
    console.warn("[Backup] AWS_BUCKET_NAME not set — skipping.");
    return { success: false, message: "AWS_BUCKET_NAME not configured" };
  }

  const db        = mongoose.connection.db;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key       = `${BACKUP_PREFIX}voycell-backup-${timestamp}.zip`;

  console.log(`[Backup] Starting backup → s3://${BUCKET}/${key}`);

  const passthrough = new PassThrough();

  // Build the ZIP and pipe it into the passthrough (no temp file needed)
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (err) => { throw err; });
  archive.pipe(passthrough);

  const infos = await db.listCollections().toArray();
  const names = infos
    .map((c) => c.name)
    .filter((n) => !EXCLUDE_COLLECTIONS.includes(n.toLowerCase()));

  for (const name of names) {
    const docs = await db.collection(name).find({}).toArray();
    const json = EJSON.stringify(docs, { relaxed: false });
    archive.append(json, { name: `${name}.json` });
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  archive.append(generateReadme(names, dateStr), { name: "README.txt" });

  // Start finalizing — this writes to the passthrough stream
  const finalizePromise = archive.finalize();

  // Collect the stream into a Buffer for S3 upload
  const chunks = [];
  for await (const chunk of passthrough) chunks.push(chunk);
  await finalizePromise;

  const body = Buffer.concat(chunks);

  await s3.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        body,
    ContentType: "application/zip",
    Metadata:    { "backup-date": dateStr, "collections": String(names.length) },
  }));

  console.log(`[Backup] ✅ Uploaded ${(body.length / 1024 / 1024).toFixed(1)} MB → ${key}`);

  // Clean up backups older than RETENTION_DAYS
  await cleanOldBackups();

  return { success: true, key, sizeBytes: body.length, collections: names.length };
};

// ── Cleanup: delete backups older than retention window ───────────────────────
const cleanOldBackups = async () => {
  if (!BUCKET) return;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const list = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: BACKUP_PREFIX,
  }));

  const toDelete = (list.Contents || []).filter(
    (obj) => obj.LastModified && new Date(obj.LastModified).getTime() < cutoff
  );

  for (const obj of toDelete) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
    console.log(`[Backup] Deleted old backup: ${obj.Key}`);
  }
};

// ── List backups with pre-signed download URLs (1h expiry) ───────────────────
const listBackups = async () => {
  if (!BUCKET) return [];
  const list = await s3.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: BACKUP_PREFIX,
  }));

  const items = (list.Contents || [])
    .filter((obj) => obj.Key !== BACKUP_PREFIX) // exclude folder placeholder
    .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));

  return Promise.all(items.map(async (obj) => {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }),
      { expiresIn: 3600 }
    );
    return {
      key:          obj.Key,
      filename:     obj.Key.replace(BACKUP_PREFIX, ""),
      sizeBytes:    obj.Size,
      lastModified: obj.LastModified,
      downloadUrl:  url,
    };
  }));
};

// ── Schedule every 2 hours ────────────────────────────────────────────────────
const startScheduler = () => {
  // Runs at minute 0 of every even hour: 00:00, 02:00, 04:00 … 22:00
  cron.schedule("0 */2 * * *", async () => {
    try {
      await runBackup();
    } catch (err) {
      console.error("[Backup] Scheduled backup failed:", err.message);
    }
  });
  console.log("[Backup] Scheduler started — backups every 2 hours → S3");
};

function generateReadme(names, dateStr) {
  return [
    "VOYCELL Automated Database Backup",
    `Date: ${dateStr}`,
    `Collections backed up: ${names.length}`,
    "",
    ...names.map((n) => `  ${n}.json`),
    "",
    "Restore: mongoimport --uri <connection_string> --db voycell --collection <name> --file <name>.json --jsonArray --drop",
  ].join("\n");
}

module.exports = { startScheduler, runBackup, listBackups };
