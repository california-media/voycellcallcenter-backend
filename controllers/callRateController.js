const CallRate       = require("../models/CallRate");
const CallRateConfig = require("../models/CallRateConfig");

// ── Zero-dependency CSV parser ────────────────────────────────────────────────
// Handles quoted fields, commas inside quotes, and CRLF/LF line endings.
// Returns an array of objects keyed by the normalised header row.
function parseCsv(buffer) {
  const text = buffer.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  const rows  = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const fields = [];
    let field    = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    rows.push(fields);
  }

  if (rows.length < 2) return [];

  // Normalise header names (lowercase, remove spaces)
  const headers = rows[0].map((h) => h.toLowerCase().replace(/\s+/g, "").replace(/['"]/g, ""));
  return rows.slice(1).map((fields) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = fields[i] ?? ""; });
    return obj;
  });
}

// ── Helper: get (or create) the global config ─────────────────────────────────
async function getConfig() {
  let cfg = await CallRateConfig.findOne({ key: "global" }).lean();
  if (!cfg) {
    cfg = await CallRateConfig.create({ key: "global", commission: 0 });
    cfg = cfg.toObject();
  }
  return cfg;
}

// ── GET /call-rates ───────────────────────────────────────────────────────────
// superadmin  → standardRate, globalCommission, customerRate per row
// companyAdmin → country, prefix, customerRate only
exports.getCallRates = async (req, res) => {
  try {
    const { country, search, page = 1, limit = 25 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const isSA = req.user?.role === "superadmin";

    const filter = {};
    if (country && country !== "all") filter.country = country;
    if (search) {
      const re = new RegExp(search, "i");
      filter.$or = [{ country: re }, { prefix: re }];
    }

    const [rawRates, total, countries, cfg] = await Promise.all([
      CallRate.find(filter).sort({ country: 1, prefix: 1 }).skip(skip).limit(parseInt(limit)).lean(),
      CallRate.countDocuments(filter),
      CallRate.distinct("country"),
      getConfig(),
    ]);
    countries.sort();

    const commission = cfg.commission || 0;

    const rates = rawRates.map((r) => {
      const customerRate = Number((r.standardRate * (1 + commission / 100)).toFixed(6));
      if (isSA) return { ...r, customerRate };
      return { _id: r._id, country: r.country, prefix: r.prefix, customerRate };
    });

    const response = { success: true, data: rates, total, countries };
    if (isSA) response.commission = commission; // send global commission to superadmin
    res.json(response);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /call-rates/config ────────────────────────────────────────────────────
// Superadmin: fetch the current global commission.
exports.getConfig = async (req, res) => {
  try {
    const cfg = await getConfig();
    res.json({ success: true, commission: cfg.commission || 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /call-rates/config ────────────────────────────────────────────────────
// Superadmin: update the global commission.
exports.updateConfig = async (req, res) => {
  try {
    const { commission } = req.body;
    if (commission === undefined || isNaN(Number(commission))) {
      return res.status(400).json({ success: false, message: "commission is required." });
    }
    const cfg = await CallRateConfig.findOneAndUpdate(
      { key: "global" },
      { $set: { commission: Number(commission) } },
      { upsert: true, new: true }
    );
    res.json({ success: true, commission: cfg.commission, message: "Commission updated." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /call-rates ──────────────────────────────────────────────────────────
exports.createCallRate = async (req, res) => {
  try {
    const { country, prefix, standardRate } = req.body;
    if (!country || !prefix || standardRate === undefined) {
      return res.status(400).json({ success: false, message: "country, prefix and standardRate are required." });
    }
    const [rate, cfg] = await Promise.all([
      CallRate.create({ country: country.trim(), prefix: prefix.trim(), standardRate: Number(standardRate) }),
      getConfig(),
    ]);
    const customerRate = Number((rate.standardRate * (1 + (cfg.commission || 0) / 100)).toFixed(6));
    res.json({ success: true, data: { ...rate.toObject(), customerRate }, message: "Call rate added." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /call-rates/:id ───────────────────────────────────────────────────────
exports.updateCallRate = async (req, res) => {
  try {
    const { country, prefix, standardRate } = req.body;
    const update = {};
    if (country      !== undefined) update.country      = country.trim();
    if (prefix       !== undefined) update.prefix       = prefix.trim();
    if (standardRate !== undefined) update.standardRate = Number(standardRate);

    const [rate, cfg] = await Promise.all([
      CallRate.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }),
      getConfig(),
    ]);
    if (!rate) return res.status(404).json({ success: false, message: "Rate not found." });
    const customerRate = Number((rate.standardRate * (1 + (cfg.commission || 0) / 100)).toFixed(6));
    res.json({ success: true, data: { ...rate.toObject(), customerRate }, message: "Call rate updated." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /call-rates/:id ────────────────────────────────────────────────────
exports.deleteCallRate = async (req, res) => {
  try {
    const rate = await CallRate.findByIdAndDelete(req.params.id);
    if (!rate) return res.status(404).json({ success: false, message: "Rate not found." });
    res.json({ success: true, message: "Call rate deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /call-rates/upload ───────────────────────────────────────────────────
exports.uploadCallRates = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded." });

    const normalised = parseCsv(req.file.buffer);
    if (!normalised.length) return res.status(400).json({ success: false, message: "CSV file is empty or has no data rows." });

    const docs   = [];
    const errors = [];

    normalised.forEach((row, i) => {
      const country      = String(row.country || row.countryname || "").trim();
      const prefix       = String(row.prefix  || row.dialcode   || row.code || "").trim();
      const standardRate = parseFloat(row.standardrate || row.standard_rate || row.rate || row.price || 0);

      if (!country || !prefix || isNaN(standardRate)) {
        errors.push(`Row ${i + 2}: missing/invalid (country="${country}", prefix="${prefix}", rate="${row.standardrate ?? row.rate}")`);
        return;
      }
      docs.push({ country, prefix, standardRate });
    });

    if (!docs.length) return res.status(400).json({ success: false, message: "No valid rows found.", errors });

    await CallRate.deleteMany({});
    await CallRate.insertMany(docs, { ordered: false });

    res.json({
      success:  true,
      imported: docs.length,
      skipped:  errors.length,
      errors:   errors.slice(0, 10),
      message:  `Successfully imported ${docs.length} call rates.${errors.length ? ` ${errors.length} row(s) skipped.` : ""}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
