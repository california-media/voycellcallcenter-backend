const EmailSenderConfig = require("../models/EmailSenderConfig");

// ── GET /notifications/email-senders ─────────────────────────────────────────
exports.listSenders = async (req, res) => {
  try {
    const senders = await EmailSenderConfig.find().sort({ isDefault: -1, createdAt: 1 });
    res.json({ status: "success", data: senders });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ── POST /notifications/email-senders ────────────────────────────────────────
exports.addSender = async (req, res) => {
  try {
    const { email, name, isDefault = false } = req.body;
    if (!email) return res.status(400).json({ status: "error", message: "email is required" });

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ status: "error", message: "Invalid email address" });
    }

    // If this is being set as default, unset any existing default first
    if (isDefault) {
      await EmailSenderConfig.updateMany({}, { isDefault: false });
    }

    // If this is the first sender ever, make it default automatically
    const count = await EmailSenderConfig.countDocuments();
    const makeDefault = isDefault || count === 0;

    const sender = await EmailSenderConfig.create({
      email:     email.trim().toLowerCase(),
      name:      name?.trim() || "VOYCELL",
      isDefault: makeDefault,
      createdBy: req.user._id,
    });

    res.status(201).json({ status: "success", data: sender });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ status: "error", message: "This email address is already configured" });
    }
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ── PUT /notifications/email-senders/:id/default ─────────────────────────────
exports.setDefault = async (req, res) => {
  try {
    const { id } = req.params;
    await EmailSenderConfig.updateMany({}, { isDefault: false });
    const sender = await EmailSenderConfig.findByIdAndUpdate(
      id,
      { isDefault: true },
      { new: true }
    );
    if (!sender) return res.status(404).json({ status: "error", message: "Sender not found" });
    res.json({ status: "success", data: sender });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

// ── DELETE /notifications/email-senders/:id ───────────────────────────────────
exports.deleteSender = async (req, res) => {
  try {
    const { id } = req.params;
    const sender = await EmailSenderConfig.findByIdAndDelete(id);
    if (!sender) return res.status(404).json({ status: "error", message: "Sender not found" });

    // If we deleted the default, promote the first remaining sender to default
    if (sender.isDefault) {
      const first = await EmailSenderConfig.findOne().sort({ createdAt: 1 });
      if (first) await EmailSenderConfig.findByIdAndUpdate(first._id, { isDefault: true });
    }

    res.json({ status: "success", message: "Sender removed" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};
