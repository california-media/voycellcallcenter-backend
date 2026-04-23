const GlobalSettings = require("../models/GlobalSettings");

// ─── Get Settings ─────────────────────────────────────────────────────────────
const getSettings = async (req, res) => {
  try {
    let settings = await GlobalSettings.findOne({ key: "global" });
    if (!settings) {
      settings = await GlobalSettings.create({ key: "global" });
    }
    res.json({ success: true, settings });
  } catch (err) {
    console.error("getSettings error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch settings" });
  }
};

// ─── Update Settings ──────────────────────────────────────────────────────────
const updateSettings = async (req, res) => {
  try {
    const { retentionDiscountPercent } = req.body;
    const update = {};

    if (retentionDiscountPercent !== undefined) {
      const val = parseInt(retentionDiscountPercent, 10);
      if (isNaN(val) || val < 1 || val > 100) {
        return res.status(400).json({
          success: false,
          message: "Retention discount must be between 1 and 100",
        });
      }
      update.retentionDiscountPercent = val;
    }

    const settings = await GlobalSettings.findOneAndUpdate(
      { key: "global" },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, message: "Settings updated successfully", settings });
  } catch (err) {
    console.error("updateSettings error:", err);
    res.status(500).json({ success: false, message: "Failed to update settings" });
  }
};

module.exports = { getSettings, updateSettings };
