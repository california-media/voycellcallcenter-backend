const mongoose = require("mongoose");
const archiver = require("archiver");
const { EJSON } = require("bson");
const { execFile, execSync } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

// Resolve mongodump binary — tries env var, then well-known install paths, then PATH
const MONGODUMP_BIN = (() => {
  const candidates = [
    process.env.MONGODUMP_PATH,
    "/Users/developer/Documents/mongodb-database-tools-macos-arm64-100.15.0/bin/mongodump",
    "/usr/local/bin/mongodump",
    "/usr/bin/mongodump",
    "/opt/homebrew/bin/mongodump",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // Last resort: try to find it on PATH
  try { return execSync("which mongodump", { encoding: "utf8" }).trim(); } catch {}
  return "mongodump"; // will fail gracefully with a clear error
})();

// Collections to exclude (high-volume transient data)
const EXCLUDE_COLLECTIONS = ["apilogs", "useractivitys", "usersessions"];

// Serialize docs to Extended JSON — required by MongoDB Compass, Atlas, and mongoimport
// Produces {"$oid":"..."} for ObjectIds, {"$date":"..."} for Dates, etc.
const toEJSON = (docs) => EJSON.stringify(docs, { relaxed: false });

// GET /superAdmin/backup/download — full ZIP backup (all collections)
const downloadBackup = async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `voycell-backup-${dateStr}.zip`;

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    });

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => { throw err; });
    archive.pipe(res);

    const collectionInfos = await db.listCollections().toArray();
    const collectionNames = collectionInfos
      .map((c) => c.name)
      .filter((name) => !EXCLUDE_COLLECTIONS.includes(name.toLowerCase()));

    // Each file is Extended JSON array — compatible with Compass, Atlas, and mongoimport
    for (const name of collectionNames) {
      const docs = await db.collection(name).find({}).toArray();
      archive.append(toEJSON(docs), { name: `${name}.json` });
    }

    archive.append(generateRestoreScript(collectionNames), { name: "restore.sh" });
    archive.append(generateReadme(collectionNames, dateStr), { name: "README.txt" });

    await archive.finalize();
  } catch (err) {
    console.error("Backup error:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Backup failed: " + err.message });
    }
  }
};

// GET /superAdmin/backup/collections — list available collections
const listCollections = async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const infos = await db.listCollections().toArray();
    const names = infos
      .map((c) => c.name)
      .filter((n) => !EXCLUDE_COLLECTIONS.includes(n.toLowerCase()))
      .sort();
    res.json({ success: true, collections: names });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /superAdmin/backup/collection/:name — single collection, Compass/Atlas ready
const downloadCollection = async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const { name } = req.params;

    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      return res.status(400).json({ success: false, message: "Invalid collection name" });
    }

    const docs = await db.collection(name).find({}).toArray();
    const json = toEJSON(docs);
    const dateStr = new Date().toISOString().slice(0, 10);

    res.set({
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${name}-${dateStr}.json"`,
    });
    res.send(json);
  } catch (err) {
    console.error("Collection backup error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

function generateRestoreScript(collectionNames) {
  return [
    "#!/bin/bash",
    "# VOYCELL Database Restore Script",
    "# Usage: bash restore.sh <mongodb_connection_string> <database_name>",
    "# Example: bash restore.sh \"mongodb+srv://user:pass@cluster.mongodb.net\" voycell",
    "",
    'MONGO_URI="${1}"',
    'DB_NAME="${2:-voycell}"',
    "",
    'if [ -z "$MONGO_URI" ]; then',
    '  echo "Error: provide a MongoDB connection string as the first argument."',
    "  exit 1",
    "fi",
    "",
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'echo "Restoring into database: $DB_NAME"',
    "",
    ...collectionNames.flatMap((name) => [
      `echo "Importing ${name}..."`,
      `mongoimport --uri "$MONGO_URI" --db "$DB_NAME" --collection "${name}" --file "$SCRIPT_DIR/${name}.json" --jsonArray --drop`,
    ]),
    "",
    'echo "Restore complete."',
  ].join("\n");
}

function generateReadme(collectionNames, dateStr) {
  return [
    "VOYCELL Database Backup",
    `Exported: ${dateStr}`,
    `Collections: ${collectionNames.length}`,
    "",
    "FORMAT: MongoDB Extended JSON (EJSON)",
    "Compatible with: MongoDB Compass, Atlas, mongoimport",
    "",
    "FILES",
    "-----",
    ...collectionNames.map((n) => `  ${n}.json`),
    "  restore.sh   — CLI restore script (uses mongoimport)",
    "  README.txt   — This file",
    "",
    "RESTORE IN COMPASS",
    "------------------",
    "1. Unzip this archive.",
    "2. Open MongoDB Compass and connect to your database.",
    "3. Select or create the target collection.",
    "4. Click ADD DATA → Import JSON file.",
    "5. Select the corresponding .json file from this archive.",
    "6. Click Import.",
    "",
    "RESTORE VIA CLI (all collections at once)",
    "-----------------------------------------",
    '  bash restore.sh "mongodb+srv://user:pass@cluster.mongodb.net" your_db_name',
    "",
    "  The --drop flag in the script replaces existing data.",
    "  Remove it from restore.sh if you want to append/merge instead.",
  ].join("\n");
}

// GET /superAdmin/backup/mongodump — native mongodump archive (BSON), best for full restore
const downloadMongodump = async (req, res) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "voycell-mongodump-"));
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `voycell-mongodump-${dateStr}.gz`;

  try {
    const mongoUri = process.env.MONGO_URL;
    if (!mongoUri) throw new Error("MONGO_URL not configured");

    // Extract DB name from URI (last path segment before any query string)
    const dbName = (() => {
      try {
        const url = new URL(mongoUri);
        return url.pathname.replace(/^\//, "").split("?")[0] || null;
      } catch { return null; }
    })();

    // Run mongodump: outputs a gzip-compressed archive to tmpDir/dump.gz
    const archivePath = path.join(tmpDir, "dump.gz");

    // --excludeCollection requires --db when --uri is used
    const excludeArgs = dbName
      ? EXCLUDE_COLLECTIONS.flatMap((col) => ["--excludeCollection", col])
      : [];

    await new Promise((resolve, reject) => {
      execFile(
        MONGODUMP_BIN,
        [
          `--uri=${mongoUri}`,
          ...(dbName ? [`--db=${dbName}`] : []),
          `--archive=${archivePath}`,
          "--gzip",
          ...excludeArgs,
        ],
        { timeout: 5 * 60 * 1000 }, // 5 min max
        (err, stdout, stderr) => {
          if (err) {
            console.error("mongodump stderr:", stderr);
            reject(new Error(stderr || err.message));
          } else {
            resolve();
          }
        }
      );
    });

    const stat = fs.statSync(archivePath);

    res.set({
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": stat.size,
    });

    const stream = fs.createReadStream(archivePath);
    stream.on("end", () => fs.rmSync(tmpDir, { recursive: true, force: true }));
    stream.on("error", () => fs.rmSync(tmpDir, { recursive: true, force: true }));
    stream.pipe(res);
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.error("mongodump error:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "mongodump failed: " + err.message });
    }
  }
};

module.exports = { downloadBackup, listCollections, downloadCollection, downloadMongodump };
