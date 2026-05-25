const User = require("../models/userModel");
const { getTransporter, interpolateTemplate } = require("./emailUtils");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const EMAILS = [
  {
    number: 1,
    dayThreshold: 0,
    subject: "Welcome to VOYCELL – Complete your account activation",
    body: `<p>Hi {{companyName}},</p>
<p>Thank you for registering with VOYCELL! To start making and receiving calls, please complete your account activation:</p>
<ol>
  <li>Log in to your account at <a href="${FRONTEND_URL}">${FRONTEND_URL}</a></li>
  <li>Verify your phone number</li>
  <li>Complete your company profile</li>
</ol>
<p>If you have any questions, our support team is here to help.</p>
<p>— The VOYCELL Team</p>`,
  },
  {
    number: 2,
    dayThreshold: 7,
    subject: "Reminder: Your VOYCELL account is waiting for activation",
    body: `<p>Hi {{companyName}},</p>
<p>You registered with VOYCELL a week ago but haven't completed your account activation yet.</p>
<p>It only takes a few minutes. <a href="${FRONTEND_URL}">Log in now</a> and verify your phone number to get started.</p>
<p>— The VOYCELL Team</p>`,
  },
  {
    number: 3,
    dayThreshold: 14,
    subject: "Action needed: Activate your VOYCELL account",
    body: `<p>Hi {{companyName}},</p>
<p>Your VOYCELL account has been inactive for 2 weeks. Please complete activation to avoid any disruption to your account.</p>
<p><a href="${FRONTEND_URL}">Activate your account now →</a></p>
<p>— The VOYCELL Team</p>`,
  },
  {
    number: 4,
    dayThreshold: 21,
    subject: "⚠️ Your VOYCELL account will be suspended in 3 days",
    body: `<p>Hi {{companyName}},</p>
<p><strong>Your account will be suspended on {{suspensionDate}} if not activated.</strong></p>
<p>To keep your account active, please <a href="${FRONTEND_URL}">log in and complete verification</a> before that date.</p>
<p>If you need help, reply to this email and our team will assist you immediately.</p>
<p>— The VOYCELL Team</p>`,
  },
];

const SUSPENSION_DAY = 24;

const runActivationReminderJob = async () => {
  const now = new Date();
  let emailsSent = 0;
  let accountsSuspended = 0;

  const candidates = await User.find({
    role: "companyAdmin",
    emailVerified: true,
    isVerified: false,
    accountStatus: { $ne: "suspended" },
    emailVerifiedAt: { $ne: null },
  }).select("email firstname lastname userInfo emailVerifiedAt activationRemindersSent");

  for (const user of candidates) {
    const daysSince = Math.floor((now - user.emailVerifiedAt) / 86400000);
    const companyName =
      user.userInfo?.companyName ||
      `${user.firstname || ""} ${user.lastname || ""}`.trim() ||
      user.email;

    // Suspend if past day 24 and all 4 emails already sent
    if (daysSince >= SUSPENSION_DAY && user.activationRemindersSent >= 4) {
      await User.findByIdAndUpdate(user._id, { accountStatus: "suspended" });
      accountsSuspended++;
      continue;
    }

    // Determine which email to send next
    const nextEmail = EMAILS.find(
      (e) => e.number === user.activationRemindersSent + 1 && daysSince >= e.dayThreshold
    );
    if (!nextEmail) continue;

    const suspensionDate = new Date(user.emailVerifiedAt);
    suspensionDate.setDate(suspensionDate.getDate() + SUSPENSION_DAY);
    const suspensionDateStr = suspensionDate.toDateString();

    try {
      const body = interpolateTemplate(nextEmail.body, { companyName, suspensionDate: suspensionDateStr });
      const subject = interpolateTemplate(nextEmail.subject, { companyName });
      await getTransporter().sendMail({
        from: '"VOYCELL" <noreply@voycell.com>',
        to: user.email,
        subject,
        html: body,
      });
      await User.findByIdAndUpdate(user._id, { $inc: { activationRemindersSent: 1 } });
      emailsSent++;
    } catch (err) {
      console.error(`Activation reminder email failed for ${user.email}:`, err.message);
    }
  }

  console.log(`Activation reminders: ${emailsSent} emails sent, ${accountsSuspended} accounts suspended`);
  return { emailsSent, accountsSuspended };
};

module.exports = { runActivationReminderJob };
