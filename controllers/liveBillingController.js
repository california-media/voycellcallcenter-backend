const User            = require("../models/userModel");
const DIDAssignment   = require("../models/DIDAssignment");
const LiveCallBilling = require("../models/LiveCallBilling");
const { findCallRateByLPM, normalizeDigits } = require("../utils/callRateLPM");
const { autoRechargeIfNeeded } = require("./creditsController");
const SystemEmailTemplate = require("../models/SystemEmailTemplate");
const { getTransporter, interpolateTemplate } = require("../utils/emailUtils");

// A real purchased DID must have at least 7 digits (rejects placeholders like "0000000")
function isRealDID(number) {
  const digits = (number || "").replace(/\D/g, "");
  return digits.length >= 7 && !/^0+$/.test(digits);
}

// ── Shared: resolve DID + rate for a given user / destination ─────────────────
// If selectedDIDNumber is provided, uses that specific number (validated against
// the company admin's owned DIDs). Otherwise auto-resolves: agent-assigned first,
// then any company DID.
async function resolveBilling(companyAdminId, userId, destination, selectedDIDNumber = null) {
  let matchedDID = null;

  // Normalize a phone number to digits only for comparison
  const digitsOnly = (n) => (n || "").replace(/\D/g, "");

  if (selectedDIDNumber) {
    const digits = digitsOnly(selectedDIDNumber);
    // Match regardless of whether the stored number has a leading + or not
    matchedDID = await DIDAssignment.findOne({
      companyAdminId,
      number: { $in: [digits, `+${digits}`] },
      status: "assigned",
    }).select("number").lean();

    if (!matchedDID) return { matchedDID: null, rate: null };
  }

  if (!matchedDID) {
    matchedDID = await DIDAssignment.findOne({
      companyAdminId,
      assignedAgentId: userId,
      status: "assigned",
    }).select("number").lean();

    if (!matchedDID) {
      matchedDID = await DIDAssignment.findOne({
        companyAdminId,
        status: "assigned",
      }).select("number").lean();
    }
  }

  if (!matchedDID || !isRealDID(matchedDID.number)) return { matchedDID: null, rate: null };

  const rate = await findCallRateByLPM(destination);
  return { matchedDID, rate };
}

// ── Shared: resolve companyAdminId from requesting user ───────────────────────
async function getCompanyAdminId(userId) {
  const user = await User.findById(userId)
    .select("role createdByWhichCompanyAdmin")
    .lean();
  if (!user) return null;
  return user.role === "user" ? user.createdByWhichCompanyAdmin : userId;
}

// ── POST /billing/pre-call-check ──────────────────────────────────────────────
const preCallCheck = async (req, res) => {
  try {
    const userId = req.user._id;
    const { destination, selectedDIDNumber } = req.body;

    if (!destination) return res.json({ canCall: true, hasDID: false });

    const companyAdminId = await getCompanyAdminId(userId);
    if (!companyAdminId) return res.json({ canCall: true, hasDID: false });

    const { matchedDID, rate } = await resolveBilling(companyAdminId, userId, destination, selectedDIDNumber);

    if (!matchedDID) {
      return res.json({ canCall: true, hasDID: false });
    }
    if (!rate) {
      return res.json({ canCall: true, hasDID: true, billing: false });
    }

    const admin = await User.findById(companyAdminId)
      .select("creditBalance autoRecharge")
      .lean();

    const balance             = admin?.creditBalance ?? 0;
    const threshold           = admin?.autoRecharge?.threshold ?? 5;
    const autoRechargeEnabled = !!(admin?.autoRecharge?.enabled);
    const canCall             = balance >= rate.customerRate;

    return res.json({
      canCall,
      hasDID:               true,
      billing:              true,
      ratePerMin:           rate.customerRate,
      currentBalance:       balance,
      threshold,
      autoRechargeEnabled,
      didNumber:            matchedDID.number,
    });
  } catch (err) {
    console.error("[preCallCheck]", err.message);
    res.json({ canCall: true, hasDID: false });
  }
};

// ── POST /billing/live-minute ─────────────────────────────────────────────────
const deductLiveMinute = async (req, res) => {
  try {
    const userId = req.user._id;
    const { destination, sdkCallId, selectedDIDNumber } = req.body;

    if (!destination) return res.json({ success: false, reason: "missing_destination" });

    const companyAdminId = await getCompanyAdminId(userId);
    if (!companyAdminId) return res.json({ success: false, reason: "no_company" });

    const { matchedDID, rate } = await resolveBilling(companyAdminId, userId, destination, selectedDIDNumber);
    if (!matchedDID) return res.json({ success: false, reason: "no_did" });
    if (!rate)       return res.json({ success: false, reason: "no_rate" });

    const adminBefore = await User.findById(companyAdminId)
      .select("creditBalance autoRecharge")
      .lean();
    const balance   = adminBefore?.creditBalance ?? 0;
    const threshold = adminBefore?.autoRecharge?.threshold ?? 5;

    if (balance < rate.customerRate) {
      return res.json({ success: false, reason: "insufficient_balance", newBalance: balance, threshold });
    }

    // Atomic deduction
    const updated = await User.findByIdAndUpdate(
      companyAdminId,
      { $inc: { creditBalance: -rate.customerRate } },
      { new: true }
    ).select("creditBalance autoRecharge");

    const newBalance     = updated?.creditBalance ?? 0;
    const newThreshold   = updated?.autoRecharge?.threshold ?? threshold;
    const destNormalized = normalizeDigits(destination);

    // Send low balance warning if balance dropped below $5
    if (newBalance < 5) {
      try {
        const template = await SystemEmailTemplate.findOne({ type: "balance_warning", isActive: true });
        if (template) {
          const freqMs = (template.reminderFrequencyDays || 7) * 24 * 60 * 60 * 1000;
          const companyAdmin = await User.findById(companyAdminId).select("email firstname lastname userInfo balanceWarningSentAt").lean();
          const lastSent = companyAdmin?.balanceWarningSentAt;
          if (!lastSent || Date.now() - new Date(lastSent).getTime() > freqMs) {
            const companyName = companyAdmin?.userInfo?.companyName
              || `${companyAdmin?.firstname || ""} ${companyAdmin?.lastname || ""}`.trim()
              || companyAdmin?.email;
            const subject = interpolateTemplate(template.subject, { companyName, balance: `$${newBalance.toFixed(2)}` });
            const body    = interpolateTemplate(template.body,    { companyName, balance: `$${newBalance.toFixed(2)}` });
            getTransporter().sendMail({
              from: '"VOYCELL" <noreply@voycell.com>',
              to: companyAdmin.email,
              subject,
              html: body,
            }).catch((e) => console.error("Balance warning email error:", e));
            await User.findByIdAndUpdate(companyAdminId, { balanceWarningSentAt: new Date() });
          }
        }
      } catch (e) {
        console.error("Balance warning trigger error:", e);
      }
    }

    const filter = sdkCallId
      ? { sdkCallId, companyAdminId }
      : {
          companyAdminId,
          destination: destNormalized,
          endedAt:     null,
          createdAt:   { $gte: new Date(Date.now() - 5 * 60 * 1000) },
        };

    const liveRecord = await LiveCallBilling.findOneAndUpdate(
      filter,
      {
        $setOnInsert: {
          userId,
          companyAdminId,
          destination: destNormalized,
          didNumber:   matchedDID.number,
          ratePerMin:  rate.customerRate,
          sdkCallId:   sdkCallId || null,
        },
        $inc: { billedMinutes: 1, totalCharged: rate.customerRate },
      },
      { upsert: true, new: true }
    );

    return res.json({
      success:    true,
      newBalance,
      charged:    rate.customerRate,
      threshold:  newThreshold,
    });
  } catch (err) {
    console.error("[deductLiveMinute]", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /billing/call-ended ──────────────────────────────────────────────────
// Called when the call terminates (frontend). Marks the live billing record closed.
const callEnded = async (req, res) => {
  try {
    const userId = req.user._id;
    const { sdkCallId } = req.body;

    if (sdkCallId) {
      const companyAdminId = await getCompanyAdminId(userId);
      if (companyAdminId) {
        await LiveCallBilling.findOneAndUpdate(
          { sdkCallId, companyAdminId, endedAt: null },
          { endedAt: new Date() }
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[callEnded]", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /billing/trigger-auto-recharge ───────────────────────────────────────
// Called during a live call when balance drops below threshold.
// Runs the same Stripe auto-recharge logic as the normal flow.
// Returns { triggered, newBalance, autoRechargeEnabled, threshold }
const triggerAutoRecharge = async (req, res) => {
  try {
    const userId = req.user._id;
    const companyAdminId = await getCompanyAdminId(userId);
    if (!companyAdminId) return res.json({ triggered: false, reason: "no_company" });

    // Read auto-recharge config before attempting
    const adminBefore = await User.findById(companyAdminId)
      .select("creditBalance autoRecharge stripeCustomerId")
      .lean();

    const autoRecharge = adminBefore?.autoRecharge;
    const enabled      = autoRecharge?.enabled ?? false;
    const threshold    = autoRecharge?.threshold ?? 5;

    if (!enabled) {
      return res.json({
        triggered:          false,
        autoRechargeEnabled: false,
        currentBalance:     adminBefore?.creditBalance ?? 0,
        threshold,
      });
    }

    // Attempt recharge (no-op if balance already above threshold or no payment method)
    await autoRechargeIfNeeded(companyAdminId);

    const adminAfter = await User.findById(companyAdminId).select("creditBalance").lean();
    const newBalance  = adminAfter?.creditBalance ?? 0;


    return res.json({
      triggered:           true,
      autoRechargeEnabled: true,
      newBalance,
      threshold,
    });
  } catch (err) {
    console.error("[triggerAutoRecharge]", err.message);
    res.status(500).json({ triggered: false, message: err.message });
  }
};

module.exports = { preCallCheck, deductLiveMinute, callEnded, triggerAutoRecharge };
