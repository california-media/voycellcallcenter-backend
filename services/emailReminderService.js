const nodemailer = require("nodemailer");
const User = require("../models/userModel");
const Subscription = require("../models/Subscription");

// ─── Transporter ──────────────────────────────────────────────────────────────
const getTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

// ─── Email Templates ──────────────────────────────────────────────────────────
const getTrialReminderHtml = (user, daysLeft) => `
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:'Inter',Arial,sans-serif;">
    <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#6366f1,#7c3aed);padding:40px 32px;text-align:center;">
        <img src="${process.env.LOGO_URL || ''}" alt="Voycell" style="height:40px;margin-bottom:16px;" />
        <h1 style="color:#fff;font-size:26px;margin:0;">Your Trial is Ending Soon</h1>
      </div>
      <div style="padding:40px 32px;">
        <p style="color:#374151;font-size:16px;">Hi <strong>${user.firstname || "there"}</strong>,</p>
        <p style="color:#374151;font-size:16px;">Your free trial will expire in <strong style="color:#7c3aed;">${daysLeft} day${daysLeft !== 1 ? "s" : ""}</strong>.</p>
        <p style="color:#6b7280;font-size:14px;">Upgrade now to keep access to all CRM features without interruption. Choose from our Monthly, Quarterly, or Yearly plans.</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${process.env.APP_URL || 'https://app.voycell.com'}/crm/upgradePlan" 
             style="background:linear-gradient(135deg,#6366f1,#7c3aed);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">
            Upgrade Now →
          </a>
        </div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0;" />
        <p style="color:#9ca3af;font-size:12px;text-align:center;">You're receiving this email because your Voycell trial expires soon. <a href="#" style="color:#6366f1;">Unsubscribe</a></p>
      </div>
    </div>
  </body>
</html>`;

const getPremiumReminderHtml = (user, daysLeft, planName, renewalDate) => `
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:'Inter',Arial,sans-serif;">
    <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);padding:40px 32px;text-align:center;">
        <img src="${process.env.LOGO_URL || ''}" alt="Voycell" style="height:40px;margin-bottom:16px;" />
        <h1 style="color:#fff;font-size:26px;margin:0;">Your ${planName} Plan Renews Soon</h1>
      </div>
      <div style="padding:40px 32px;">
        <p style="color:#374151;font-size:16px;">Hi <strong>${user.firstname || "there"}</strong>,</p>
        <p style="color:#374151;font-size:16px;">Your <strong>${planName}</strong> subscription will renew in <strong style="color:#0ea5e9;">${daysLeft} day${daysLeft !== 1 ? "s" : ""}</strong> on <strong>${renewalDate}</strong>.</p>
        <p style="color:#6b7280;font-size:14px;">Your payment method on file will be charged automatically. If you need to make any changes, please do so before the renewal date.</p>
        <div style="text-align:center;margin:32px 0;">
          <a href="${process.env.APP_URL || 'https://app.voycell.com'}/crm/upgradePlan" 
             style="background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">
            Manage Subscription →
          </a>
        </div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0;" />
        <p style="color:#9ca3af;font-size:12px;text-align:center;">You're receiving this email because you have an active Voycell subscription.</p>
      </div>
    </div>
  </body>
</html>`;

// ─── Send Functions ───────────────────────────────────────────────────────────

/**
 * Send trial expiry reminder
 */
const sendTrialExpiryReminder = async (user, daysLeft) => {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Voycell" <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: `Your trial expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""} — Upgrade Now`,
    html: getTrialReminderHtml(user, daysLeft),
  });
  console.log(`Trial reminder sent to ${user.email} (${daysLeft} days left)`);
};

/**
 * Send subscription/premium expiry reminder
 */
const sendSubscriptionExpiryReminder = async (user, daysLeft, planName, renewalDate) => {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"Voycell" <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: `Your ${planName} plan renews in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
    html: getPremiumReminderHtml(user, daysLeft, planName, renewalDate),
  });
  console.log(`Subscription reminder sent to ${user.email} (${daysLeft} days left)`);
};

// ─── Main Cron Handler (called by AWS Scheduler daily) ────────────────────────

/**
 * Process all subscription/trial reminder emails.
 * This is intended to be triggered once daily by AWS EventBridge Scheduler.
 */
const processExpiryReminders = async () => {
  const now = new Date();
  const results = { trial: 0, subscription: 0, errors: 0 };

  try {
    // ── 1. Trial users ────────────────────────────────────────────────────
    const trialUsers = await User.find({
      role: "companyAdmin",
      planStatus: "trial",
      trialEndsAt: { $gt: now },
      email: { $exists: true, $ne: null },
    });

    for (const user of trialUsers) {
      const msLeft = new Date(user.trialEndsAt) - now;
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
      const reminders = user.emailReminderDays || [7, 3, 1];
      const sent = user.reminderEmailsSent || [];

      if (reminders.includes(daysLeft) && !sent.includes(daysLeft)) {
        try {
          await sendTrialExpiryReminder(user, daysLeft);
          await User.findByIdAndUpdate(user._id, {
            $push: { reminderEmailsSent: daysLeft },
          });
          results.trial++;
        } catch (err) {
          console.error(`Failed to send trial reminder to ${user.email}:`, err.message);
          results.errors++;
        }
      }
    }

    // ── 2. Active subscription users ────────────────────────────────────
    const activeSubscriptions = await Subscription.find({
      status: "active",
      currentPeriodEnd: { $gt: now },
    }).populate({ path: "userId", select: "email firstname emailReminderDays reminderEmailsSent planStatus" })
      .populate({ path: "planId", select: "name" });

    for (const sub of activeSubscriptions) {
      const user = sub.userId;
      if (!user || !user.email) continue;

      const msLeft = new Date(sub.currentPeriodEnd) - now;
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
      const reminders = user.emailReminderDays || [7, 3, 1];
      const sent = user.reminderEmailsSent || [];
      const renewalDate = new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      });

      if (reminders.includes(daysLeft) && !sent.includes(daysLeft)) {
        try {
          await sendSubscriptionExpiryReminder(user, daysLeft, sub.planId?.name || "Premium", renewalDate);
          await User.findByIdAndUpdate(user._id, {
            $push: { reminderEmailsSent: daysLeft },
          });
          results.subscription++;
        } catch (err) {
          console.error(`Failed to send subscription reminder to ${user.email}:`, err.message);
          results.errors++;
        }
      }
    }

    console.log("Reminder processing complete:", results);
    return results;
  } catch (err) {
    console.error("Error in processExpiryReminders:", err);
    throw err;
  }
};

module.exports = {
  sendTrialExpiryReminder,
  sendSubscriptionExpiryReminder,
  processExpiryReminders,
};
