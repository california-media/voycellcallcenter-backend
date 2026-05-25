// voycellcallcenter-backend/utils/activationReminderJob.js
const User                  = require("../models/userModel");
const ActivationEmailConfig = require("../models/ActivationEmailConfig");
const { getTransporter, interpolateTemplate } = require("./emailUtils");

const runActivationReminderJob = async () => {
  const config = await ActivationEmailConfig.findOne({ key: "global" }).lean();
  if (!config || !config.isActive || !config.emails || config.emails.length === 0) {
    return { emailsSent: 0, accountsSuspended: 0 };
  }

  const now    = new Date();
  const emails = config.emails.slice().sort((a, b) => a.order - b.order);
  const total  = emails.length;

  let emailsSent = 0;
  let accountsSuspended = 0;

  const candidates = await User.find({
    role:                  "companyAdmin",
    emailVerified:         true,
    isVerified:            false,
    accountStatus:         { $ne: "suspended" },
    nextActivationEmailAt: { $lte: now, $ne: null },
  }).select("email firstname lastname userInfo emailVerifiedAt activationRemindersSent");

  for (const user of candidates) {
    const idx  = user.activationRemindersSent;
    const name =
      user.userInfo?.companyName ||
      `${user.firstname || ""} ${user.lastname || ""}`.trim() ||
      user.email;

    if (!user.emailVerifiedAt) {
      await User.findByIdAndUpdate(user._id, { nextActivationEmailAt: null });
      continue;
    }

    const lastEmailDay   = emails[total - 1].delayDays;
    const suspensionDate = new Date(
      user.emailVerifiedAt.getTime() +
      (lastEmailDay + config.suspensionDaysAfterLastEmail) * 86400000
    );

    if (idx < total) {
      const emailDef = emails[idx];
      try {
        const subject = interpolateTemplate(emailDef.subject, { name });
        const body    = interpolateTemplate(emailDef.body,    { name, suspensionDate: suspensionDate.toDateString() });
        await getTransporter().sendMail({
          from:    '"VOYCELL" <noreply@voycell.com>',
          to:      user.email,
          subject,
          html:    body,
        });

        const update = { $inc: { activationRemindersSent: 1 } };
        if (idx + 1 < total) {
          update.$set = {
            nextActivationEmailAt: new Date(
              user.emailVerifiedAt.getTime() + emails[idx + 1].delayDays * 86400000
            ),
          };
        } else {
          update.$set = { nextActivationEmailAt: suspensionDate };
        }

        await User.findByIdAndUpdate(user._id, update);
        emailsSent++;
      } catch (err) {
        console.error(`Activation reminder email failed for ${user.email}:`, err.message);
      }
    } else {
      try {
        await User.findByIdAndUpdate(user._id, {
          accountStatus:         "suspended",
          nextActivationEmailAt: null,
        });
        accountsSuspended++;
      } catch (err) {
        console.error(`Activation suspension failed for ${user.email}:`, err.message);
      }
    }
  }

  console.log(`Activation reminders: ${emailsSent} emails sent, ${accountsSuspended} accounts suspended`);
  return { emailsSent, accountsSuspended };
};

module.exports = { runActivationReminderJob };
