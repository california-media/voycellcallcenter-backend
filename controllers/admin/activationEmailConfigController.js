const ActivationEmailConfig = require("../../models/ActivationEmailConfig");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const DEFAULT_EMAILS = [
  {
    order: 1,
    delayDays: 1,
    subject: "VOYCELL: Complete your account activation",
    body: `<p>Hi {{name}},</p>
<p>Thank you for registering with VOYCELL! To get started, please verify your phone number:</p>
<ol>
  <li><a href="${FRONTEND_URL}">Log in to your account</a></li>
  <li>Complete phone number verification</li>
</ol>
<p>— The VOYCELL Team</p>`,
  },
  {
    order: 2,
    delayDays: 8,
    subject: "VOYCELL: Reminder — Your account is waiting for activation",
    body: `<p>Hi {{name}},</p>
<p>It has been a week since you registered but your VOYCELL account is still not fully activated.</p>
<p><a href="${FRONTEND_URL}">Log in now</a> and verify your phone number to get started.</p>
<p>— The VOYCELL Team</p>`,
  },
  {
    order: 3,
    delayDays: 15,
    subject: "VOYCELL: Action needed — Activate your account",
    body: `<p>Hi {{name}},</p>
<p>Your VOYCELL account has been inactive for two weeks. Please complete activation to avoid suspension.</p>
<p><a href="${FRONTEND_URL}">Activate your account now →</a></p>
<p>— The VOYCELL Team</p>`,
  },
  {
    order: 4,
    delayDays: 18,
    subject: "⚠️ VOYCELL: Your account will be suspended in 3 days",
    body: `<p>Hi {{name}},</p>
<p><strong>Your VOYCELL account will be suspended on {{suspensionDate}} if not activated.</strong></p>
<p>To keep your account, please <a href="${FRONTEND_URL}">log in and verify your phone number</a> before that date.</p>
<p>Need help? Reply to this email and our team will assist you.</p>
<p>— The VOYCELL Team</p>`,
  },
];

const getActivationEmailConfig = async (req, res) => {
  try {
    let config = await ActivationEmailConfig.findOne({ key: "global" });
    if (!config) {
      config = await ActivationEmailConfig.create({
        key: "global",
        isActive: true,
        suspensionDaysAfterLastEmail: 3,
        emails: DEFAULT_EMAILS,
      });
    }
    res.json({ status: "success", data: config });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

const updateActivationEmailConfig = async (req, res) => {
  try {
    const { isActive, suspensionDaysAfterLastEmail, emails } = req.body;

    if (!Array.isArray(emails) || emails.length < 2) {
      return res.status(400).json({ status: "error", message: "At least 2 emails required" });
    }

    for (let i = 0; i < emails.length; i++) {
      const e = emails[i];
      if (e.order == null || typeof e.delayDays !== "number" || !e.subject?.trim() || !e.body?.trim()) {
        return res.status(400).json({ status: "error", message: `Email #${i + 1} is missing required fields (order, delayDays, subject, body)` });
      }
    }

    for (let i = 1; i < emails.length; i++) {
      if (emails[i].delayDays <= emails[i - 1].delayDays) {
        return res.status(400).json({ status: "error", message: "delayDays must be strictly increasing" });
      }
    }

    const config = await ActivationEmailConfig.findOneAndUpdate(
      { key: "global" },
      { isActive, suspensionDaysAfterLastEmail, emails },
      { new: true, upsert: true }
    );
    res.json({ status: "success", data: config });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

module.exports = { getActivationEmailConfig, updateActivationEmailConfig };
