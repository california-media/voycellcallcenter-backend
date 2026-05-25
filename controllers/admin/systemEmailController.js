const SystemEmailTemplate = require("../../models/SystemEmailTemplate");

const DEFAULTS = {
  balance_warning: {
    subject: "VOYCELL: Low Balance Warning",
    body: `<p>Hi {{companyName}},</p>
<p>Your VOYCELL credit balance has dropped below $5. Current balance: <strong>{{balance}}</strong>.</p>
<p>Please top up your credits to avoid service interruption.</p>
<p>Best regards,<br/>VOYCELL Team</p>`,
    reminderFrequencyDays: 7,
  },
  account_locked: {
    subject: "VOYCELL: Account Locked — Unlock Your Account",
    body: `<p>Hi {{companyName}},</p>
<p>Your VOYCELL account has been locked for 24 hours due to multiple failed login attempts.</p>
<p>To unlock your account immediately, click the button below:</p>
<p><a href="{{magicLink}}" style="background:#6366f1;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;">Unlock My Account</a></p>
<p>If you did not attempt to log in, please contact support.</p>
<p>Best regards,<br/>VOYCELL Team</p>`,
    reminderFrequencyDays: 1,
  },
};

const getSystemEmailTemplates = async (req, res) => {
  try {
    for (const [type, defaults] of Object.entries(DEFAULTS)) {
      await SystemEmailTemplate.findOneAndUpdate(
        { type },
        { $setOnInsert: { type, ...defaults } },
        { upsert: true, new: false }
      );
    }
    const templates = await SystemEmailTemplate.find({});
    res.json({ status: "success", data: templates });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

const updateSystemEmailTemplate = async (req, res) => {
  try {
    const { type } = req.params;
    if (!["balance_warning", "account_locked"].includes(type)) {
      return res.status(400).json({ status: "error", message: "Invalid template type" });
    }
    const { subject, body, isActive, reminderFrequencyDays } = req.body;
    const updated = await SystemEmailTemplate.findOneAndUpdate(
      { type },
      { subject, body, isActive, reminderFrequencyDays },
      { new: true, upsert: true }
    );
    res.json({ status: "success", data: updated });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
};

module.exports = { getSystemEmailTemplates, updateSystemEmailTemplate };
