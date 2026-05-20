const axios = require("axios");
// const moment = require("moment");
const mongoose = require("mongoose");
const { getDeviceToken } = require("../services/yeastarTokenService");
const YeastarToken = require("../models/YeastarToken");
const User = require("../models/userModel"); // make sure to import
const CallHistory = require("../models/CallHistory");
const moment = require("moment-timezone");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const { zohoAfterCallSync } = require("../services/zohoAfterCallSync.service");
const { createZoomMeeting } = require("../utils/zoomCalendar");
const { createGoogleMeetEvent } = require("../utils/googleCalendar");
const incomingcallConnection = require("../models/incomingcallConnection");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const { hubspotAfterCallSync } = require("../services/hubspotSync.service");
const Notification                             = require("../models/Notification");
const DIDAssignment                            = require("../models/DIDAssignment");
const LiveCallBilling                          = require("../models/LiveCallBilling");
const { findCallRateByLPM, normalizeDigits }   = require("../utils/callRateLPM");

// ── Billing helpers ───────────────────────────────────────────────────────────
function isRealDID(number) {
  const digits = (number || "").replace(/\D/g, "");
  return digits.length >= 7 && !/^0+$/.test(digits);
}

async function calculateAndBill({ companyAdminId, userId, call_from, call_to, talk_time, yeastarId, startTime }) {
  if (!companyAdminId || !userId || !call_to || !talk_time) {
    return null;
  }

  // ── Check if this call was already live-billed (prevents double deduction) ──
  // Try exact sdkCallId match first, then time-based fallback
  let liveBill = null;
  if (yeastarId) {
    liveBill = await LiveCallBilling.findOne({ sdkCallId: yeastarId, companyAdminId }).lean();
  }
  if (!liveBill && startTime) {
    const callMoment = moment(startTime, "MM/DD/YYYY HH:mm:ss");
    if (callMoment.isValid()) {
      const callDate = callMoment.toDate();
      liveBill = await LiveCallBilling.findOne({
        companyAdminId,
        destination: normalizeDigits(call_to),
        endedAt:     { $ne: null },
        createdAt: {
          $gte: new Date(callDate.getTime() - 2 * 60 * 1000),                     // 2 min before start
          $lte: new Date(callDate.getTime() + (talk_time + 600) * 1000),           // end + 10 min buffer
        },
      }).sort({ createdAt: -1 }).lean();
    }
  }
  if (liveBill && liveBill.billedMinutes > 0) {
    return {
      charges:    Number(liveBill.totalCharged.toFixed(6)),
      ratePerMin: liveBill.ratePerMin,
      billedFrom: liveBill.didNumber || call_from,
    };
  }

  // No live billing record — only bill if call_from is itself a real purchased DID.
  // If call_from is a PBX extension (e.g. "1010"), live billing should have handled it;
  // skip CDR billing to avoid billing calls made from non-purchased numbers.
  const callFromDigits = normalizeDigits(call_from || "");

  if (!isRealDID(callFromDigits)) {
    return null;
  }

  // PATH A: call_from is a real phone number → check directly against admin's purchased DIDs
  const allCompanyDIDs = await DIDAssignment.find({ companyAdminId, status: "assigned" })
    .select("number").lean();

  const matchedDID = allCompanyDIDs.find(d => normalizeDigits(d.number) === callFromDigits) || null;

  if (!matchedDID) {
    return null;
  }

  // LPM lookup on destination
  const rate = await findCallRateByLPM(call_to);

  if (!rate) {
    return null;
  }

  const billedMinutes = Math.ceil(talk_time / 60);
  const charges       = Number((billedMinutes * rate.customerRate).toFixed(6));

  if (charges <= 0) {
    return null;
  }

  await User.findByIdAndUpdate(companyAdminId, { $inc: { creditBalance: -charges } });

  return { charges, ratePerMin: rate.customerRate, billedFrom: matchedDID.number };
}


/**
 * Format date like PHP (m/d/Y H:i:s)
 */
function formatDate(date, fallbackTime) {
  let m;

  // If date already contains time → use as-is
  if (date.includes(":")) {
    m = moment(date, "YYYY-MM-DD HH:mm:ss");
  } else {
    m = moment(`${date} ${fallbackTime}`, "YYYY-MM-DD HH:mm:ss");
  }

  return m.format("MM/DD/YYYY HH:mm:ss");
}

function normalizeNumber(number) {
  if (!number) return "";

  // Simply remove non-digits, but keep original if possible for parsing
  return number.toString().replace(/\D/g, "");
}

// ======================================================
// 📞 Extract countryCode + number (Global support)
// ======================================================
function extractNumberDetails(rawNumber) {
  if (!rawNumber) return null;

  let cleaned = rawNumber.toString().replace(/\D/g, "");
  let toParse = rawNumber.toString();

  // 1. Handle "00" prefix as international "+"
  if (cleaned.startsWith("00")) {
    toParse = "+" + cleaned.substring(2);
  }
  // 2. Handle "0" prefix for long numbers (11+ digits) as potential international
  else if (cleaned.startsWith("0") && cleaned.length >= 11) {
    toParse = "+" + cleaned.substring(1);
  }
  // 3. UAE aggressive heuristics if not already handled
  else if (!toParse.startsWith("+")) {
    // If 9 digits starting with 50, 52, 54, 55, 56, 58 -> UAE mobile missing prefix
    if (cleaned.length === 9 && /^(50|52|54|55|56|58)/.test(cleaned)) {
      toParse = "0" + cleaned;
    }
    // If 12 digits starting with 971 -> UAE with country code but no +
    else if (cleaned.length === 12 && cleaned.startsWith("971")) {
      toParse = "+" + cleaned;
    }
  }

  // Attempt parsing with UAE hint first (common for this app)
  let parsed = parsePhoneNumberFromString(toParse, "AE");

  // 4. If still fails or invalid, try stripping all leading zeros and prepending + (strict international)
  if (!parsed || !parsed.isValid()) {
    let cleanNoZeros = cleaned.replace(/^0+/, "");
    if (cleanNoZeros) {
      let globalTry = parsePhoneNumberFromString("+" + cleanNoZeros);
      if (globalTry && globalTry.isValid()) {
        parsed = globalTry;
      }
    }
  }

  // Final fallback if libphonenumber fails
  if (!parsed || !parsed.isValid()) {
    // If it was 9 digits starting with 5, it's likely UAE missing leading 0
    if (cleaned.length === 9 && /^(50|52|54|55|56|58)/.test(cleaned)) {
      return { countryCode: "971", number: cleaned };
    }

    // Default to UAE + last 10 digits as a last resort
    let finalNumber = cleaned.replace(/^0+/, "");
    return {
      countryCode: "971",
      number: finalNumber.slice(-10),
    };
  }

  return {
    countryCode: parsed.countryCallingCode,
    number: parsed.nationalNumber,
  };
}

// ======================================================
// 🔍 Find Contact / Lead (Company-wide match)
// ======================================================
async function findRecord(details, allowedUserIds) {
  if (!details?.number) return null;

  // Normalize number for search: try both as-is and with leading 0 if 9 digits
  let searchNumbers = [details.number];
  if (
    details.number.length === 9 &&
    /^(50|52|54|55|56|58)/.test(details.number)
  ) {
    searchNumbers.push("0" + details.number);
  } else if (details.number.length === 10 && details.number.startsWith("0")) {
    searchNumbers.push(details.number.substring(1));
  }

  // 1️⃣ Full match (country + number)
  if (details.countryCode) {
    let contact = await Contact.findOne({
      phoneNumbers: {
        $elemMatch: {
          countryCode: details.countryCode,
          number: { $in: searchNumbers },
        },
      },
      createdBy: { $in: allowedUserIds },
    });
    if (contact) return contact;

    let lead = await Lead.findOne({
      phoneNumbers: {
        $elemMatch: {
          countryCode: details.countryCode,
          number: { $in: searchNumbers },
        },
      },
      createdBy: { $in: allowedUserIds },
    });
    if (lead) return lead;
  }

  // 2️⃣ Match only number (Fallback)
  let contact = await Contact.findOne({
    "phoneNumbers.number": { $in: searchNumbers },
    createdBy: { $in: allowedUserIds },
  });
  if (contact) return contact;

  let lead = await Lead.findOne({
    "phoneNumbers.number": { $in: searchNumbers },
    createdBy: { $in: allowedUserIds },
  });

  return lead || null;
}

async function fetchAndStoreForAgent({ agent, companyAdminId, allowedCreatedByIds, TZ, encodedStart, encodedEnd, startTime, endTime }) {
  const agentId = agent._id;
  const performerName = `${agent.firstname} ${agent.lastname}`;

  const extensions = (agent.assignedExtensions || []).filter(
    (e) => e.extensionNumber && e.assignedDeviceId
  );

  console.log(`[CDR-FETCH] agent=${performerName} | assignedExtensions total=${(agent.assignedExtensions||[]).length} | valid (has ext+device)=${extensions.length}`);
  (agent.assignedExtensions || []).forEach((e, i) => {
    console.log(`[CDR-FETCH]   ext[${i}]: extensionNumber=${e.extensionNumber} assignedDeviceId=${e.assignedDeviceId} PBX_BASE_URL=${e.PBX_BASE_URL || "(none)"}`);
  });

  if (!extensions.length) {
    console.log(`[CDR-FETCH] agent=${performerName} → SKIPPED (no valid extensions)`);
    return 0;
  }

  const httpsAgent = new (require("https").Agent)({ rejectUnauthorized: false });
  // tokenCache: deviceKey → { token, baseUrl }
  const tokenCache = {};
  // callMap: call.id → { call, extensionNumber }
  const callMap = new Map();

  for (const extEntry of extensions) {
    const { extensionNumber, assignedDeviceId, PBX_BASE_URL } = extEntry;
    try {
      const deviceKey = assignedDeviceId.toString();
      if (!tokenCache[deviceKey]) {
        const token = await getDeviceToken(assignedDeviceId, "pbx");
        let baseUrl = PBX_BASE_URL || null;
        if (!baseUrl) {
          const tokenDoc = await YeastarToken.findOne({ deviceId: assignedDeviceId }).select("base_url").lean();
          baseUrl = tokenDoc?.base_url || null;
        }
        console.log(`[CDR-FETCH]   deviceId=${deviceKey} → token=${token ? "OK" : "MISSING"} baseUrl=${baseUrl || "MISSING"}`);
        tokenCache[deviceKey] = { token, baseUrl };
      }
      const { token, baseUrl } = tokenCache[deviceKey];

      if (!baseUrl) {
        console.log(`[CDR-FETCH]   ext=${extensionNumber} deviceId=${deviceKey} → SKIPPED (no baseUrl)`);
        continue;
      }

      const urlFrom = `${baseUrl}/cdr/search?access_token=${token}&call_from=${extensionNumber}&start_time=${encodedStart}&end_time=${encodedEnd}`;
      const urlTo   = `${baseUrl}/cdr/search?access_token=${token}&call_to=${extensionNumber}&start_time=${encodedStart}&end_time=${encodedEnd}`;

      console.log(`[CDR-FETCH]   ext=${extensionNumber} → fetching CDR from baseUrl=${baseUrl}`);

      const [respFrom, respTo] = await Promise.all([
        axios.get(urlFrom, { httpsAgent }),
        axios.get(urlTo,   { httpsAgent }),
      ]);

      const fromList = Array.isArray(respFrom.data?.data) ? respFrom.data.data : [];
      const toList   = Array.isArray(respTo.data?.data)   ? respTo.data.data   : [];

      console.log(`[CDR-FETCH]   ext=${extensionNumber} → from_calls=${fromList.length} to_calls=${toList.length}`);

      const extensionPhone = extEntry.PBX_TELEPHONE || null;
      [...fromList, ...toList].forEach((c) => {
        const callId = c.id ?? c.call_id;
        if (callId == null) return;
        const mapKey = `${deviceKey}:${callId}`;
        if (!callMap.has(mapKey)) {
          callMap.set(mapKey, { call: c, callId: String(callId), extensionNumber, extensionPhone });
        }
      });
    } catch (extErr) {
      console.log(`[CDR-FETCH]   ext=${extensionNumber} → ERROR: ${extErr.message}`);
    }
  }

  let finalList = [...callMap.values()];

  // log breakdown by extension so we can verify cross-device dedup is working
  const byExt = {};
  finalList.forEach(({ extensionNumber: en }) => { byExt[en] = (byExt[en] || 0) + 1; });
  console.log(`[CDR-INSERT] agent=${performerName} | callMap size=${callMap.size} | breakdown: ${JSON.stringify(byExt)}`);

  let inserted = 0;
  let skippedDuplicate = 0;

  console.log(`[CDR-INSERT] agent=${performerName} | total unique calls to process=${finalList.length}`);

  for (const { call, callId, extensionNumber, extensionPhone } of finalList) {
    if (!callId) continue;
    const exists = await CallHistory.findOne({ yeastarId: callId, extensionNumber });
    if (exists) {
      skippedDuplicate++;
      if (exists.talk_time == null) {
        await CallHistory.updateOne(
          { yeastarId: callId, extensionNumber },
          { $set: { talk_time: call.talk_duration ?? 0 } }
        );
      }
      continue;
    }
    console.log(`[CDR-INSERT] NEW call | ext=${extensionNumber} | id=${callId} | type=${call.call_type} | disposition=${call.disposition} | from=${call.call_from_number} | to=${call.call_to_number}`);

    const from_number = normalizeNumber(call.call_from_number);
    const to_number = normalizeNumber(call.call_to_number);
    const fromDetails = extractNumberDetails(from_number);
    const toDetails = extractNumberDetails(to_number);

    let fromRecord = await findRecord(fromDetails, allowedCreatedByIds);
    let toRecord = await findRecord(toDetails, allowedCreatedByIds);

    const dubaiFormatted = moment
      .tz(call.time, "MM/DD/YYYY HH:mm:ss", TZ)
      .format("MM/DD/YYYY HH:mm:ss");

    if (call.disposition === "NO ANSWER") {
      if (call.call_type === "Inbound" && !fromRecord) {
        const doubleCheck = await findRecord(fromDetails, allowedCreatedByIds);
        const newID = new mongoose.Types.ObjectId();
        if (!doubleCheck) {
          fromRecord = await Lead.create({
            _id: newID,
            contact_id: newID,
            firstname: "Unknown",
            lastname: "Caller",
            phoneNumbers: [
              {
                countryCode: fromDetails.countryCode || "971",
                number: fromDetails.number,
              },
            ],
            status: "noAnswer",
            createdBy: agentId,
            activities: [
              {
                action: "Lead Created",
                type: "lead",
                title: "Automated Lead Creation",
                  description: `Lead created from unanswered call (by ${performerName})`,
                  timestamp: dubaiFormatted,
                },
              ],
            });
          } else {
            fromRecord = doubleCheck;
          }
        }

        if (fromRecord) {
          fromRecord.status = "noAnswer";
          await fromRecord.save();
        }
        if (toRecord) {
          toRecord.status = "noAnswer";
          await toRecord.save();
        }
      }

      const talkTime = call.talk_duration ?? 0;

      let billingResult = null;
      if (call.call_type === "Outbound" && call.disposition === "ANSWERED" && talkTime > 0) {
        try {
          billingResult = await calculateAndBill({
            companyAdminId,
            userId: agentId,
            call_from:  from_number,
            call_to:    to_number,
            talk_time:  talkTime,
            yeastarId:  callId,
            startTime:  dubaiFormatted,
          });
        } catch (billingErr) {
          // billing error — non-fatal
        }
      }

      const dbPayload = {
        userId: agentId,
        extensionNumber:  extensionNumber,
        extensionPhone:   extensionPhone || null,
        yeastarId:        callId,
        call_from:        from_number,
        call_to:          to_number,
        talk_time:        talkTime,
        ring_time:        call.ring_duration  ?? 0,
        duration:         call.duration       ?? 0,
        direction:        call.call_type,
        status:           call.disposition,
        start_time:       dubaiFormatted,
        end_time:         dubaiFormatted,
        record_file:      call.record_file,
        disposition_code: call.reason,
        trunk:            call.dst_trunk,
        charges:          billingResult?.charges    ?? null,
        ratePerMin:       billingResult?.ratePerMin ?? null,
        billedFrom:       billingResult?.billedFrom ?? null,
      };

      try {
        await CallHistory.create(dbPayload);
        inserted++;
        console.log(`[CDR-INSERT] ✓ saved | ext=${extensionNumber} | id=${callId} | userId=${agentId} | direction=${call.call_type}`);
      } catch (createErr) {
        console.log(`[CDR-INSERT] ✗ FAILED to save | ext=${extensionNumber} | id=${callId} | error=${createErr.message}`);
      }

      if (call.disposition === "NO ANSWER" && call.call_type === "Inbound") {
        const callerDisplay = from_number || "Unknown";
        const notifyIds = [agentId];
        if (agent.createdByWhichCompanyAdmin) {
          notifyIds.push(agent.createdByWhichCompanyAdmin);
        }
        const missedNotifDocs = notifyIds.map((uid) => ({
          userId: uid,
          companyId: companyAdminId,
          title: "Missed Call",
          description: `You missed an incoming call from ${callerDisplay}.`,
          body: "",
          attachments: [],
          category: "missed_call",
          createdBy: agentId,
        }));
        await Notification.insertMany(missedNotifDocs);
      }

      const baseActivity = {
        action: "Call activity",
        type: "call",
        title: call.call_type === "Outbound" ? "Outgoing Call" : "Incoming Call",
        description: `Call ${call.disposition} | Duration: ${call.duration}s (by ${performerName})`,
        timestamp: dubaiFormatted,
      };

      if (fromRecord) {
        fromRecord.activities.push({
          ...baseActivity,
          description: `Call with ${to_number} | ${call.disposition} (by ${performerName})`,
        });
        await fromRecord.save();
      }

      if (toRecord) {
        toRecord.activities.push({
          ...baseActivity,
          description: `Call with ${from_number} | ${call.disposition} (by ${performerName})`,
        });
        await toRecord.save();
      }
    }

  console.log(`[CDR-INSERT] agent=${performerName} | DONE | inserted=${inserted} skipped(duplicate)=${skippedDuplicate}`);
  return inserted;
}

exports.fetchAndStoreCallHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(400).json({ success: false, message: "User not found" });
    }

    const TZ = process.env.YEASTAR_TZ || "Asia/Dubai";
    const endMoment = moment().tz(TZ);
    const startMoment = endMoment.clone().subtract(24, "hours");
    const startTime = startMoment.format("MM/DD/YYYY HH:mm:ss");
    const endTime = endMoment.format("MM/DD/YYYY HH:mm:ss");
    const encodedStart = encodeURIComponent(startTime);
    const encodedEnd = encodeURIComponent(endTime);

    if (user.role === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: userId,
        role: "user",
      });

      // Include the admin themselves alongside agents
      const usersToFetch = [user, ...agents].filter(
        (u) => (u.assignedExtensions || []).some(e => e.assignedDeviceId && e.extensionNumber)
      );

      console.log(`[CDR-FETCH] companyAdmin=${userId} | total agents=${agents.length} | users with valid extensions=${usersToFetch.length}`);
      [user, ...agents].forEach((u) => {
        const exts = (u.assignedExtensions || []);
        const validExts = exts.filter(e => e.assignedDeviceId && e.extensionNumber);
        console.log(`[CDR-FETCH]   user=${u.firstname} ${u.lastname} (${u._id}) | assignedExtensions=${exts.length} valid=${validExts.length}`);
        exts.forEach((e, i) => {
          console.log(`[CDR-FETCH]     ext[${i}]: extensionNumber=${e.extensionNumber} assignedDeviceId=${e.assignedDeviceId} PBX_BASE_URL=${e.PBX_BASE_URL || "MISSING"}`);
        });
      });

      if (!usersToFetch.length) {
        return res.json({ status: "success", message: "No users with PBX extensions found", newInserted: 0 });
      }

      const allowedCreatedByIds = [userId, ...agents.map((a) => a._id)];
      let totalInserted = 0;

      for (const person of usersToFetch) {
        try {
          totalInserted += await fetchAndStoreForAgent({
            agent: person,
            companyAdminId: userId,
            allowedCreatedByIds,
            TZ,
            encodedStart,
            encodedEnd,
            startTime,
            endTime,
          });
        } catch (agentErr) {
          console.log(`[CDR-FETCH] ERROR for user ${person.firstname} ${person.lastname}: ${agentErr.message}`);
        }
      }

      return res.json({
        status: "success",
        message: `Stored ${totalInserted} new call records across ${usersToFetch.length} users`,
        newInserted: totalInserted,
      });
    }

    const hasAnyExtension =
      user.PBXDetails?.PBX_EXTENSION_NUMBER ||
      (user.assignedExtensions || []).some((e) => e.extensionNumber);

    if (!hasAnyExtension) {
      return res.status(400).json({ success: false, message: "User extension not found" });
    }

    const companyAdminId = user.createdByWhichCompanyAdmin || null;
    let allowedCreatedByIds = [userId];
    if (companyAdminId) {
      const siblings = await User.find({ createdByWhichCompanyAdmin: companyAdminId, role: "user" }).select("_id");
      allowedCreatedByIds = [companyAdminId, ...siblings.map((a) => a._id)];
    }

    const inserted = await fetchAndStoreForAgent({
      agent: user,
      companyAdminId,
      allowedCreatedByIds,
      TZ,
      encodedStart,
      encodedEnd,
      startTime,
      endTime,
    });

    return res.json({
      status: "success",
      userId,
      extension: user.PBXDetails?.PBX_EXTENSION_NUMBER || null,
      time_window: { startTime, endTime },
      newInserted: inserted,
      message: `Stored ${inserted} new call records`,
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Failed to fetch/store call history",
      error: err.response?.data || err.message,
    });
  }
};

exports.fetchAndStoreCall10DaysHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(400).json({ success: false, message: "User not found" });
    }

    const TZ = process.env.YEASTAR_TZ || "Asia/Dubai";
    const endMoment = moment().tz(TZ);
    const startMoment = endMoment.clone().subtract(10, "days");
    const startTime = startMoment.format("MM/DD/YYYY HH:mm:ss");
    const endTime = endMoment.format("MM/DD/YYYY HH:mm:ss");
    const encodedStart = encodeURIComponent(startTime);
    const encodedEnd = encodeURIComponent(endTime);

    if (user.role === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: userId,
        role: "user",
      });

      const usersToFetch = [user, ...agents].filter(
        (u) => (u.assignedExtensions || []).some(e => e.assignedDeviceId && e.extensionNumber)
      );

      if (!usersToFetch.length) {
        return res.json({ status: "success", message: "No users with PBX extensions found", newInserted: 0 });
      }

      const allowedCreatedByIds = [userId, ...agents.map((a) => a._id)];
      let totalInserted = 0;

      for (const person of usersToFetch) {
        try {
          totalInserted += await fetchAndStoreForAgent({
            agent: person,
            companyAdminId: userId,
            allowedCreatedByIds,
            TZ,
            encodedStart,
            encodedEnd,
            startTime,
            endTime,
          });
        } catch (agentErr) {
          console.error(`[fetch-and-store-10d] Error for user ${person._id}:`, agentErr.message);
        }
      }

      return res.json({
        status: "success",
        message: `Stored ${totalInserted} new call records across ${usersToFetch.length} users`,
        newInserted: totalInserted,
      });
    }

    const hasAnyExtension =
      user.PBXDetails?.PBX_EXTENSION_NUMBER ||
      (user.assignedExtensions || []).some((e) => e.extensionNumber);

    if (!hasAnyExtension) {
      return res.status(400).json({ success: false, message: "User extension not found" });
    }

    const companyAdminId = user.createdByWhichCompanyAdmin || null;
    let allowedCreatedByIds = [userId];
    if (companyAdminId) {
      const siblings = await User.find({ createdByWhichCompanyAdmin: companyAdminId, role: "user" }).select("_id");
      allowedCreatedByIds = [companyAdminId, ...siblings.map((a) => a._id)];
    }

    const inserted = await fetchAndStoreForAgent({
      agent: user,
      companyAdminId,
      allowedCreatedByIds,
      TZ,
      encodedStart,
      encodedEnd,
      startTime,
      endTime,
    });

    return res.json({
      status: "success",
      userId,
      extension: user.PBXDetails?.PBX_EXTENSION_NUMBER || null,
      time_window: { startTime, endTime },
      newInserted: inserted,
      message: `Stored ${inserted} new call records`,
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Failed to fetch/store call history",
      error: err.response?.data || err.message,
    });
  }
};

// 🌍 GLOBAL PHONE NORMALIZATION
const normalizeForCustomerNameNumber = (num) => {
  if (!num) return "";

  // 1️⃣ Remove non-digits
  let cleaned = num.toString().replace(/\D/g, "");

  // 2️⃣ Remove leading zeros
  cleaned = cleaned.replace(/^0+/, "");

  return cleaned;
};

// 🔥 Generate possible match variants
const getNumberVariants = (num) => {
  const normalized = normalizeForCustomerNameNumber(num);

  if (!normalized) return [];

  const variants = new Set();

  // full number
  variants.add(normalized);

  // last 12, 11, 10, 9, 8, 7 digits (fallback matching)
  for (let i = 7; i <= 12; i++) {
    if (normalized.length >= i) {
      variants.add(normalized.slice(-i));
    }
  }

  return Array.from(variants);
};

exports.getCompanyCallHistory = async (req, res) => {
  try {
    const loginUserId = req.user._id;

    // 🔐 Admin check
    const admin = await User.findOne({
      _id: loginUserId,
      role: "companyAdmin",
    }).select("_id");

    if (!admin) {
      return res.status(403).json({
        status: "error",
        message: "Only company admin can access this API",
      });
    }

    const {
      page = 1,
      page_size = 10,
      search = "",
      status = [],
      callType = [],
      startDate,
      endDate,
      agentId = [],
    } = req.body;

    const skip = (page - 1) * page_size;

    // ------------------------------------
    // 1️⃣ Get ALL company users
    // ------------------------------------
    const agents = await User.find({
      createdByWhichCompanyAdmin: admin._id,
    }).select("_id");

    const allUserIds = [admin._id, ...agents.map((a) => a._id)];

    // ------------------------------------
    // 2️⃣ RECORD USER FILTER (agentId)
    // ------------------------------------
    let recordUserIds = allUserIds;

    if (Array.isArray(agentId) && agentId.length) {
      recordUserIds = agentId.map((id) => new mongoose.Types.ObjectId(id));
    }

    // ------------------------------------
    // 3️⃣ RECORD MATCH (FILTERED)
    // ------------------------------------
    const recordMatch = {
      userId: { $in: recordUserIds },
    };

    // ❌ Exclude Internal calls
    recordMatch.direction = { $ne: "Internal" };

    if (search.trim()) {
      recordMatch.$or = [
        { call_from: { $regex: search, $options: "i" } },
        { call_to: { $regex: search, $options: "i" } },
      ];
    }

    if (status.length) {
      const map = {
        answered: "ANSWERED",
        missedCall: "NO ANSWER",
        cancelled: "BUSY",
        invalid: "FAILED",
      };
      recordMatch.status = {
        $in: status.map((s) => map[s]).filter(Boolean),
      };
    }

    if (callType.length) {
      const map = {
        inbound: "Inbound",
        outbound: "Outbound",
        // internal: "Internal",
      };
      recordMatch.direction = {
        $in: callType.map((t) => map[t]).filter(Boolean),
      };
    }

    if (startDate && endDate) {
      recordMatch.$expr = {
        $and: [
          {
            $gte: [
              {
                $dateFromString: {
                  dateString: "$start_time",
                  format: "%m/%d/%Y %H:%M:%S",
                },
              },
              new Date(startDate),
            ],
          },
          {
            $lte: [
              {
                $dateFromString: {
                  dateString: "$start_time",
                  format: "%m/%d/%Y %H:%M:%S",
                },
              },
              new Date(endDate),
            ],
          },
        ],
      };
    }

    // ------------------------------------
    // 4️⃣ RECORD AGGREGATION
    // ------------------------------------
    const recordsPipeline = [
      { $match: recordMatch },

      {
        $addFields: {
          startDateObj: {
            $dateFromString: {
              dateString: "$start_time",
              format: "%m/%d/%Y %H:%M:%S",
            },
          },
        },
      },

      { $sort: { startDateObj: -1 } },

      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          pipeline: [{ $project: { firstname: 1, lastname: 1, role: 1 } }],
          as: "owner",
        },
      },
      { $unwind: "$owner" },

      // {
      //   $addFields: {
      //     ownerName: {
      //       $concat: ["$owner.firstname", " ", "$owner.lastname"],
      //     },
      //     ownerRole: "$owner.role",
      //   },
      // },

      {
        $addFields: {
          ownerName: {
            $concat: ["$owner.firstname", " ", "$owner.lastname"],
          },
          ownerRole: "$owner.role",
        },
      },

      {
        $facet: {
          records: [{ $skip: skip }, { $limit: page_size }],
          total: [{ $count: "count" }],
        },
      },
    ];

    // --- diagnostic: raw DB counts for 2010 extension ---
    const raw2010Count    = await CallHistory.countDocuments({ extensionNumber: "2010" });
    const raw2010Internal = await CallHistory.countDocuments({ extensionNumber: "2010", direction: "Internal" });
    const raw2010Outbound = await CallHistory.countDocuments({ extensionNumber: "2010", direction: "Outbound" });
    const raw2010Inbound  = await CallHistory.countDocuments({ extensionNumber: "2010", direction: "Inbound" });
    const raw2010UserId   = await CallHistory.distinct("userId", { extensionNumber: "2010" });
    console.log(`[CDR-QUERY] ext=2010 in DB | total=${raw2010Count} internal=${raw2010Internal} outbound=${raw2010Outbound} inbound=${raw2010Inbound}`);
    console.log(`[CDR-QUERY] ext=2010 userIds in DB: ${JSON.stringify(raw2010UserId)}`);
    console.log(`[CDR-QUERY] allUserIds in query: ${JSON.stringify(allUserIds)}`);
    console.log(`[CDR-QUERY] recordMatch: ${JSON.stringify(recordMatch)}`);
    // ---

    const recordResult = await CallHistory.aggregate(recordsPipeline);
    const aggregateTotal = recordResult[0]?.total?.[0]?.count || 0;
    console.log(`[CDR-QUERY] aggregate returned total=${aggregateTotal} records (page size=${page_size})`);

    const callRecords = recordResult[0]?.records || [];

    // ------------------------------------
    // 🔥 CUSTOMER NAME LOOKUP
    // ------------------------------------

    // 1️⃣ Collect all numbers from call records
    const allNumbersSet = new Set();

    callRecords.forEach((call) => {
      if (call.call_from) {
        getNumberVariants(call.call_from).forEach((v) => allNumbersSet.add(v));
      }
      if (call.call_to) {
        getNumberVariants(call.call_to).forEach((v) => allNumbersSet.add(v));
      }
    });

    const allNumbers = Array.from(allNumbersSet);

    // 2️⃣ Get all contacts & leads of company
    const contacts = await Contact.find({
      createdBy: { $in: allUserIds },
    }).select("firstname lastname phoneNumbers");

    const leads = await Lead.find({
      createdBy: { $in: allUserIds },
    }).select("firstname lastname phoneNumbers");

    // 3️⃣ Create number → name map
    const numberToNameMap = {};

    // 🔹 From Contacts
    contacts.forEach((c) => {
      c.phoneNumbers.forEach((p) => {
        const normalized = normalizeNumber(p.number);
        getNumberVariants(p.number).forEach((variant) => {
          if (variant && !numberToNameMap[variant]) {
            numberToNameMap[variant] =
              (c.firstname || "") + " " + (c.lastname || "");
          }
        });
      });
    });

    // 🔹 From Leads (only if not already found)
    leads.forEach((l) => {
      l.phoneNumbers.forEach((p) => {
        const normalized = normalizeNumber(p.number);
        // if (normalized && !numberToNameMap[normalized]) {
        //   numberToNameMap[normalized] =
        //     (l.firstname || "") + " " + (l.lastname || "");
        // }

        getNumberVariants(p.number).forEach((variant) => {
          if (variant && !numberToNameMap[variant]) {
            numberToNameMap[variant] =
              (l.firstname || "") + " " + (l.lastname || "");
          }
        });
      });
    });

    // 4️⃣ Attach customerName in callRecords
    const updatedCallRecords = callRecords.map((call) => {
      // let customerNumber =
      //   call.direction === "Inbound"
      //     ? normalizeNumber(call.call_from)
      //     : normalizeNumber(call.call_to);
      let numberToCheck =
        call.direction === "Inbound"
          ? call.call_from
          : call.call_to;

      let customerName = "";

      // try all variants
      const variants = getNumberVariants(numberToCheck);

      for (let v of variants) {
        if (numberToNameMap[v]) {
          customerName = numberToNameMap[v];
          break;
        }
      }

      // const customerName = numberToNameMap[customerNumber] || "";

      return {
        ...call,
        customerName: customerName.trim(),
      };
    });

    const totalRecords = recordResult[0]?.total[0]?.count || 0;

    // ------------------------------------
    // 5️⃣ SUMMARY (ALL-TIME, FIXED)
    // ------------------------------------
    const summaryMatch = {
      userId: { $in: allUserIds },
    };

    const summaryData = await CallHistory.aggregate([
      { $match: summaryMatch },
      {
        $group: {
          _id: null,
          inbound: {
            $sum: { $cond: [{ $eq: ["$direction", "Inbound"] }, 1, 0] },
          },
          outbound: {
            $sum: { $cond: [{ $eq: ["$direction", "Outbound"] }, 1, 0] },
          },
          // internal: {
          //   $sum: { $cond: [{ $eq: ["$direction", "Internal"] }, 1, 0] },
          // },
          missed: {
            $sum: { $cond: [{ $eq: ["$status", "NO ANSWER"] }, 1, 0] },
          },
        },
      },
    ]);

    const summary = summaryData[0] || {
      inbound: 0,
      outbound: 0,
      internal: 0,
      missed: 0,
    };

    return res.json({
      status: "success",
      summary: {
        inboundCalls: summary.inbound,
        outboundCalls: summary.outbound,
        // internalCalls: summary.internal,
        missedCalls: summary.missed,
        totalCalls: summary.inbound + summary.outbound,
        // + summary.internal,
      },
      page,
      page_size,
      totalRecords,
      callRecords: updatedCallRecords,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Failed to fetch call history",
      error: err.message,
    });
  }
};

exports.getAgentCallHistory = async (req, res) => {
  try {
    const loginUserId = req.user._id;

    // 1️⃣ Fetch logged-in company admin
    const agent = await User.findById(loginUserId).select(
      "_id firstname lastname extensionNumber role PBXDetails",
    );

    if (!agent) {
      return res.status(400).json({
        status: "error",
        message: "agent admin not found",
      });
    }

    const agentExtension = agent.PBXDetails?.PBX_EXTENSION_NUMBER;

    // 2️⃣ Request filters
    const {
      page = 1,
      page_size = 20,
      search = "",
      status = [],
      callType = [],
      startDate = "",
      endDate = "",
    } = req.body;

    // 3️⃣ Decide whose calls to show
    let finalExtension = agentExtension; // default → show only admin calls
    let agentName = `${agent.firstname} ${agent.lastname}`;

    let query = {
      // extensionNumber: finalExtension,
      userId: loginUserId,
    };

    // ❌ Exclude Internal calls globally
    // query.direction = { $ne: "Internal" };

    // 5️⃣ Search filter
    if (search.trim() !== "") {
      query.$or = [
        { call_from: { $regex: search, $options: "i" } },
        { call_to: { $regex: search, $options: "i" } },
      ];
    }

    // 6️⃣ Status array filter
    if (Array.isArray(status) && status.length > 0) {
      const statusMap = {
        answered: "ANSWERED",
        missedCall: "NO ANSWER",
        noAnswered: "NO ANSWER",
        cancelled: "BUSY",
        invalid: "FAILED",
      };

      const mapped = status.map((s) => statusMap[s]).filter(Boolean);

      if (mapped.length > 0) {
        query.status = { $in: mapped };
      }
    }

    // 7️⃣ Call types array (Inbound/Outbound/Internal)
    if (Array.isArray(callType) && callType.length > 0) {
      const typeMap = {
        inbound: "Inbound",
        outbound: "Outbound",
        // internal: "Internal",
      };

      const mapped = callType.map((t) => typeMap[t]).filter(Boolean);

      if (mapped.length > 0) {
        query.direction = { $in: mapped };
      }
    }

    // 8️⃣ Date Filter (SAFE for STRING + DATE + NULL values)
    // if (startDate && endDate) {
    //   query.$expr = {
    //     $and: [
    //       {
    //         $gte: [
    //           {
    //             $dateFromString: {
    //               dateString: { $toString: "$start_time" }, // ✅ forces to string
    //               format: "%m/%d/%Y %H:%M:%S",
    //               onError: new Date("1970-01-01"), // ✅ prevents crash
    //               onNull: new Date("1970-01-01"), // ✅ prevents crash
    //             },
    //           },
    //           new Date(startDate),
    //         ],
    //       },
    //       {
    //         $lte: [
    //           {
    //             $dateFromString: {
    //               dateString: { $toString: "$start_time" }, // ✅ forces to string
    //               format: "%m/%d/%Y %H:%M:%S",
    //               onError: new Date("2999-01-01"), // ✅ prevents crash
    //               onNull: new Date("2999-01-01"), // ✅ prevents crash
    //             },
    //           },
    //           new Date(endDate),
    //         ],
    //       },
    //     ],
    //   };
    // }

    if (startDate && endDate) {
      query.$expr = {
        $and: [
          {
            $gte: [
              {
                $dateFromString: {
                  dateString: "$start_time",
                  format: "%m/%d/%Y %H:%M:%S",
                  timezone: "UTC",
                  onError: new Date("1970-01-01"),
                  onNull: new Date("1970-01-01"),
                },
              },
              new Date(startDate),
            ],
          },
          {
            $lte: [
              {
                $dateFromString: {
                  dateString: "$start_time",
                  format: "%m/%d/%Y %H:%M:%S",
                  timezone: "UTC",
                  onError: new Date("2999-01-01"),
                  onNull: new Date("2999-01-01"),
                },
              },
              new Date(endDate),
            ],
          },
        ],
      };
    }

    // 9️⃣ Pagination
    const skip = (page - 1) * page_size;

    const totalRecords = await CallHistory.countDocuments(query);

    const callRecords = await CallHistory.find(query)
      .sort({ start_time: -1 })
      .skip(skip)
      .limit(page_size);

    // ------------------------------------
    // 🔥 CUSTOMER NAME LOOKUP (AGENT ONLY)
    // ------------------------------------

    // 1️⃣ Collect all numbers from calls
    const allNumbersSet = new Set();

    callRecords.forEach((call) => {
      if (call.call_from) {
        getNumberVariants(call.call_from).forEach((v) =>
          allNumbersSet.add(v)
        );
      }
      if (call.call_to) {
        getNumberVariants(call.call_to).forEach((v) =>
          allNumbersSet.add(v)
        );
      }
    });

    // 2️⃣ Fetch ONLY agent's contacts & leads
    const contacts = await Contact.find({
      createdBy: loginUserId,
    }).select("firstname lastname phoneNumbers");

    const leads = await Lead.find({
      createdBy: loginUserId,
    }).select("firstname lastname phoneNumbers");

    // 3️⃣ Create number → name map
    const numberToNameMap = {};

    // 🔹 Contacts
    contacts.forEach((c) => {
      c.phoneNumbers.forEach((p) => {
        getNumberVariants(p.number).forEach((variant) => {
          if (variant && !numberToNameMap[variant]) {
            numberToNameMap[variant] =
              (c.firstname || "") + " " + (c.lastname || "");
          }
        });
      });
    });

    // 🔹 Leads
    leads.forEach((l) => {
      l.phoneNumbers.forEach((p) => {
        getNumberVariants(p.number).forEach((variant) => {
          if (variant && !numberToNameMap[variant]) {
            numberToNameMap[variant] =
              (l.firstname || "") + " " + (l.lastname || "");
          }
        });
      });
    });


    // 🔟 Summary filter
    const summaryFilter = {
      // extensionNumber: finalExtension,
      userId: loginUserId,
    };

    const inbound = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Inbound",
    });

    const outbound = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Outbound",
    });

    const missed = await CallHistory.countDocuments({
      ...summaryFilter,
      status: "NO ANSWER",
    });

    const total = inbound + outbound;
    // + internal;

    // 1️⃣1️⃣ Add agentName to each record
    // const finalData = callRecords.map((c) => ({
    //   ...c._doc,
    //   agentName,
    // }));

    // 1️⃣1️⃣ Add agentName + customerName
    const finalData = callRecords.map((c) => {
      // 🔥 Decide which number is customer
      let numberToCheck =
        c.direction === "Inbound" ? c.call_from : c.call_to;

      let customerName = "";

      // 🔥 Generate all variants
      const variants = getNumberVariants(numberToCheck);

      // 🔥 Find first match
      for (let v of variants) {
        if (numberToNameMap[v]) {
          customerName = numberToNameMap[v];
          break;
        }
      }

      return {
        ...c._doc,
        agentName,
        customerName: customerName.trim(), // ✅ FINAL FIELD
      };
    });

    return res.json({
      status: "success",
      summary: {
        inboundCalls: inbound,
        // internal,
        outboundCalls: outbound,
        missedCalls: missed,
        totalCalls: total,
      },
      page: Number(page),
      page_size: Number(page_size),
      totalRecords,
      callRecords: finalData,
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve call history",
      error: err.message,
    });
  }
};

exports.getPhoneNumberCallHistory = async (req, res) => {
  try {
    const loginUserId = req.user._id;

    /* 👤 Logged-in user */
    const loginUser = await User.findById(loginUserId).select(
      "_id firstname lastname role createdByWhichCompanyAdmin",
    );

    if (!loginUser) {
      return res.status(400).json({
        status: "error",
        message: "User not found",
      });
    }

    /* 📥 Request body */
    const {
      page = 1,
      page_size = 20,
      search = "",
      status = [],
      callType = [],
      startDate,
      endDate,
      phonenumbers = [],
    } = req.body;

    if (!Array.isArray(phonenumbers) || !phonenumbers.length) {
      return res.status(400).json({
        status: "error",
        message: "Phone numbers list is required",
      });
    }

    /* 🔐 ROLE BASED ACCESS */
    let allowedUserIds = [];

    if (loginUser.role === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: loginUser._id,
        role: "user",
      }).select("_id");

      allowedUserIds = [loginUser._id, ...agents.map((a) => a._id)];
    } else {
      allowedUserIds = [loginUser._id];
    }

    /* 📞 PHONE NORMALIZATION */
    const normalize = (v) => v?.toString().replace(/\D/g, "") || "";

    const phoneSet = new Set();
    phonenumbers.forEach((p) => {
      const num = normalize(p.number);
      const cc = normalize(p.countryCode);
      if (!num) return;

      phoneSet.add(num);
      phoneSet.add("0" + num);
      if (cc) {
        phoneSet.add(cc + num);
        phoneSet.add(cc + "0" + num);
      }
    });

    const phones = [...phoneSet];

    /* 🎯 FILTER MAPS */
    const statusMap = {
      answered: "ANSWERED",
      missedCall: "NO ANSWER",
      noAnswered: "NO ANSWER",
      cancelled: "BUSY",
      invalid: "FAILED",
    };

    const typeMap = {
      inbound: "Inbound",
      outbound: "Outbound",
      internal: "Internal",
    };

    const skip = (page - 1) * page_size;

    /* 🚀 AGGREGATION PIPELINE */
    const pipeline = [
      {
        $match: {
          userId: { $in: allowedUserIds },
        },
      },
      {
        $match: {
          $or: [{ call_from: { $in: phones } }, { call_to: { $in: phones } }],
        },
      },

      /* ✅ CONVERT start_time STRING → DATE */
      {
        $addFields: {
          startTimeDate: {
            $dateFromString: {
              dateString: "$start_time",
              format: "%m/%d/%Y %H:%M:%S",
              onError: null,
              onNull: null,
            },
          },
        },
      },
    ];

    /* 🔎 SEARCH */
    if (search.trim()) {
      pipeline.push({
        $match: {
          $or: [
            { call_from: { $regex: search, $options: "i" } },
            { call_to: { $regex: search, $options: "i" } },
          ],
        },
      });
    }

    /* 📅 DATE FILTER (BASED ON start_time) */
    if (startDate && endDate) {
      pipeline.push({
        $match: {
          startTimeDate: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
          },
        },
      });
    }

    /* 📌 STATUS FILTER */
    if (status.length) {
      pipeline.push({
        $match: {
          status: {
            $in: status.map((s) => statusMap[s]).filter(Boolean),
          },
        },
      });
    }

    /* 🔁 CALL TYPE FILTER */
    if (callType.length) {
      pipeline.push({
        $match: {
          direction: {
            $in: callType.map((t) => typeMap[t]).filter(Boolean),
          },
        },
      });
    }

    /* 📦 PAGINATION + TOTAL COUNT */
    pipeline.push({
      $facet: {
        records: [
          { $sort: { startTimeDate: -1 } },
          { $skip: skip },
          { $limit: page_size },
          {
            $lookup: {
              from: "users",
              localField: "userId",
              foreignField: "_id",
              as: "owner",
            },
          },
          {
            $unwind: {
              path: "$owner",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $addFields: {
              ownerName: {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ["$owner.firstname", ""] },
                      " ",
                      { $ifNull: ["$owner.lastname", ""] },
                    ],
                  },
                },
              },
              ownerRole: "$owner.role",
            },
          },
          // ✅ THIS IS THE IMPORTANT FIX
          {
            $project: {
              owner: 0, // ❌ remove full owner object
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    });

    const result = await CallHistory.aggregate(pipeline);

    const callRecords = result[0]?.records || [];
    const totalRecords = result[0]?.total[0]?.count || 0;

    /* 📊 SUMMARY (NO DATE FILTER) */
    const summaryCalls = await CallHistory.find({
      userId: { $in: allowedUserIds },
      $or: [{ call_from: { $in: phones } }, { call_to: { $in: phones } }],
    }).select("direction status");

    let inboundCalls = 0;
    let outboundCalls = 0;
    let missedCalls = 0;

    summaryCalls.forEach((c) => {
      if (c.direction === "Inbound") inboundCalls++;
      if (c.direction === "Outbound") outboundCalls++;
      if (c.status === "NO ANSWER") missedCalls++;
    });

    /* ✅ FINAL RESPONSE */
    return res.json({
      status: "success",
      summary: {
        inboundCalls,
        outboundCalls,
        missedCalls,
        totalCalls: inboundCalls + outboundCalls,
      },
      page,
      page_size,
      totalRecords,
      callRecords,
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve phone number call history",
      error: err.message,
    });
  }
};

exports.callRecordingDownload = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("PBXDetails");

    const assignedDeviceId = user?.PBXDetails?.assignedDeviceId;

    if (!assignedDeviceId) {
      return res.status(400).json({
        status: "error",
        message: "User does not have an assigned PBX device",
      });
    }

    const token = await getDeviceToken(assignedDeviceId, "pbx");

    const PBX_BASE_URL = user.PBXDetails.PBX_BASE_URL;

    const { record_file } = req.body;

    if (!record_file) {
      return res.status(400).json({
        status: "error",
        message: "record_file is required",
      });
    }

    // ---- STEP 1 ----
    // Correct API URL based on your working Postman request
    const url1 = `${PBX_BASE_URL}/recording/download?access_token=${token}&file=${encodeURIComponent(
      record_file,
    )}`;

    const step1 = await axios.get(url1);
    if (!step1.data.download_resource_url) {
      return res.status(500).json({
        status: "error",
        message: "Yeastar did not return download_resource_url",
        yeastarResponse: step1.data,
      });
    }

    function getMediaBaseUrl(pbxBaseUrl) {
      try {
        const url = new URL(pbxBaseUrl);
        return `${url.protocol}//${url.host}`;
      } catch (err) {
        return pbxBaseUrl;
      }
    }

    const MEDIA_BASE_URL = getMediaBaseUrl(PBX_BASE_URL);

    const downloadPath = step1.data.download_resource_url;
    const url2 = `${MEDIA_BASE_URL}${downloadPath}?access_token=${token}`;

    return res.json({
      status: "success",
      fileName: record_file,
      mimeType: "audio/wav",
      fileUrl: url2,
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Failed to download recording",
      error: err.message,
    });
  }
};

exports.getInboundOutBoundCallGraph = async (req, res) => {
  try {
    const loginUserId = req.user._id;

    // Fetch logged in user (could be admin or agent/user)
    const loggedUser = await User.findById(loginUserId).select(
      "role createdByWhichCompanyAdmin",
    );

    if (!loggedUser) {
      return res.status(400).json({
        status: "error",
        message: "User not found",
      });
    }

    let userIdsToInclude = [];

    // 🟦 CASE 1: companyAdmin → include ALL users created by this admin + admin itself
    if (loggedUser.role === "companyAdmin") {
      const allUsers = await User.find({
        $or: [
          { createdByWhichCompanyAdmin: loginUserId },
          { _id: loginUserId }, // include admin calls also
        ],
      }).select("_id");

      userIdsToInclude = allUsers.map((u) => u._id);
    } else {
      // 🟩 CASE 2: agent/user → only own calls
      userIdsToInclude = [loginUserId];
    }

    // ------------------------------
    // DATE RANGE: DYNAMIC (from query) OR LAST 30 DAYS
    // ------------------------------

    const today = new Date();

    let startDate, endDate;

    if (req.query.startDate && req.query.endDate) {
      const [sy, sm, sd] = req.query.startDate.split("-").map(Number);
      const [ey, em, ed] = req.query.endDate.split("-").map(Number);
      startDate = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0));
      endDate = new Date(Date.UTC(ey, em - 1, ed + 1, 0, 0, 0));
    } else {
      endDate = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() + 1, // next day at 00:00
          0,
          0,
          0,
        ),
      );
      startDate = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() - 29,
          0,
          0,
          0,
        ),
      );
    }

    const numDays = Math.max(1, Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)));

    // ------------------------------
    // FETCH CALLS
    // ------------------------------

    // ── Fast indexed query using startTimeParsed ──────────────────────────────
    // Uses the compound index { userId, startTimeParsed } — sub-millisecond on
    // any dataset size.  Replaces the old $expr + $dateFromString full-scan.
    // Records created before the migration will have startTimeParsed: null and
    // are excluded from the fast path; the migration (in CallHistory.js) backfills
    // them at server startup so this is only a transient gap.
    const calls = await CallHistory.find({
      userId:           { $in: userIdsToInclude },
      startTimeParsed:  { $gte: startDate, $lt: endDate },
    }).select("startTimeParsed direction");

    // ------------------------------
    // FORMAT DATE: 24 Nov 2025
    // ------------------------------
    const formatDate = (dateObj) => {
      const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ];

      return `${String(dateObj.getUTCDate()).padStart(2, "0")} ${months[dateObj.getUTCMonth()]
        } ${dateObj.getUTCFullYear()}`;
    };

    // ------------------------------
    // BUILD EMPTY DAY ARRAY (forward order: earliest first)
    // ------------------------------
    const daysArray = [];

    for (let i = 0; i < numDays; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      daysArray.push({
        date: formatDate(d),
        inbound: 0,
        outbound: 0,
      });
    }

    // ------------------------------
    // COUNT CALLS DAY-WISE
    // ------------------------------
    calls.forEach((call) => {
      // startTimeParsed is already a real Date — no string parsing needed
      const d = call.startTimeParsed;
      if (!d) return;

      const diffDays = Math.floor((d - startDate) / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays < numDays) {
        if (call.direction === "Inbound") {
          daysArray[diffDays].inbound++;
        } else if (call.direction === "Outbound") {
          daysArray[diffDays].outbound++;
        }
      }
    });

    // ------------------------------
    // SEND FINAL RESULT
    // ------------------------------
    const rangeEnd = new Date(endDate.getTime() - 24 * 60 * 60 * 1000); // subtract 1 day added for exclusive upper bound
    return res.json({
      status: "success",
      range: {
        start: formatDate(startDate),
        end: formatDate(rangeEnd),
      },
      days: daysArray, // already earliest → latest
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getMonthlyCallGraph = async (req, res) => {
  try {
    const loginUserId = req.user._id;

    // 1️⃣ Fetch logged-in user
    const loginUser = await User.findById(loginUserId).select(
      "_id role createdByWhichCompanyAdmin",
    );

    if (!loginUser) {
      return res.status(400).json({
        status: "error",
        message: "User not found",
      });
    }

    // 2️⃣ Read Start / End Dates from request
    let { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        status: "error",
        message: "startDate and endDate are required format YYYY-MM-DD",
      });
    }

    // Convert to real dates
    startDate = new Date(startDate + "T00:00:00.000Z");
    endDate = new Date(endDate + "T23:59:59.999Z");

    // 3️⃣ Build userIds to search
    let userIdsToSearch = [loginUserId];

    if (loginUser.role === "companyAdmin") {
      // include admin + all agents
      const agents = await User.find({
        createdByWhichCompanyAdmin: loginUserId,
      }).select("_id");

      const agentIds = agents.map((x) => x._id);

      userIdsToSearch = [...userIdsToSearch, ...agentIds];
    }

    // 4️⃣ Fetch calls — fast indexed query using startTimeParsed
    // Uses compound index { userId, startTimeParsed } — replaces the old
    // $expr + $dateFromString full-collection-scan that caused infinite loading
    // on cold Lambda starts.
    const calls = await CallHistory.find({
      userId:          { $in: userIdsToSearch },
      direction:       { $ne: "Internal" },
      startTimeParsed: { $gte: startDate, $lte: endDate },
    }).select("direction status userId");

    // 7️⃣ Summary counts
    const inboundTotal = calls.filter((c) => c.direction === "Inbound").length;
    const outboundTotal = calls.filter(
      (c) => c.direction === "Outbound",
    ).length;
    const answeredTotal = calls.filter((c) => c.status === "ANSWERED").length;
    const invalidTotal = calls.filter((c) => c.status === "FAILED").length;
    const cancelledTotal = calls.filter((c) => c.status === "BUSY").length;
    const missedTotal = calls.filter((c) => c.status === "NO ANSWER").length;

    const totalCalls = inboundTotal + outboundTotal;

    return res.json({
      status: "success",
      startDate: moment(startDate).format("DD MMM YYYY"),
      endDate: moment(endDate).format("DD MMM YYYY"),

      summary: {
        inboundTotal,
        outboundTotal,
        missedTotal,
        answeredTotal,
        invalidTotal,
        cancelledTotal,
        totalCalls,
      },

      role: loginUser.role,
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.addFormDataAfterCallEnd = async (req, res) => {
  try {
    const { phoneNumbers, firstname, lastname, status, note, meeting } =
      req.body;
    const userId = req.user._id;
    console.log(phoneNumbers, firstname, lastname, status, note, meeting, "phoneNumbers, firstname, lastname, status, note, meeting ");

    // -----------------------------------------------
    // ⭐ NEW: Determine company admin and agent group
    // -----------------------------------------------
    const loggedInUser = await User.findById(userId);








    console.log("[DEBUG] userId being queried:", userId);
    console.log("[DEBUG] loggedInUser._id:", loggedInUser?._id);
    console.log("[DEBUG] loggedInUser.pipedrive raw:", JSON.stringify(loggedInUser?.pipedrive, null, 2));
    console.log("[DEBUG] loggedInUser.hubspot.isConnected:", loggedInUser?.hubspot?.isConnected);
    console.log("[DEBUG] loggedInUser.zoho.isConnected:", loggedInUser?.zoho?.isConnected);




    // Find company admin ID
    let companyAdminId =
      loggedInUser.role === "companyAdmin"
        ? loggedInUser._id
        : loggedInUser.createdByWhichCompanyAdmin;

    // Find all agents under this admin
    let allAgents = await User.find({
      createdByWhichCompanyAdmin: companyAdminId,
    }).select("_id");

    // Final allowed user list for search
    let allowedUserIds = [
      companyAdminId, // the admin
      ...allAgents.map((a) => a._id), // all agents of this admin
      userId, // logged-in user
    ];

    if (!phoneNumbers || !phoneNumbers.countryCode || !phoneNumbers.number) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const { countryCode, number } = phoneNumbers;

    // ---------- Normalize incoming ----------
    let rawCountry = String(phoneNumbers.countryCode || "")
      .trim()
      .replace(/\D/g, "");
    let rawNumber = String(phoneNumbers.number || "")
      .trim()
      .replace(/\D/g, "");

    let contact = await Contact.findOne({
      createdBy: { $in: allowedUserIds },
      "phoneNumbers.countryCode": rawCountry,
      "phoneNumbers.number": rawNumber,
    });

    let lead = await Lead.findOne({
      createdBy: { $in: allowedUserIds },
      "phoneNumbers.countryCode": rawCountry,
      "phoneNumbers.number": rawNumber,
    });

    let targetDoc = null;
    let targetType = null;

    // ✅ CHECK IF CONTACT EXISTS BUT LEAD DOES NOT
    const shouldConvertToLead =
      contact &&
      !lead &&
      (status === "interested" ||
        status === "callBack" ||
        status === "callSuccess");

    if (shouldConvertToLead) {
      // ✅ CONVERT CONTACT → LEAD (FULL DATA COPY)
      const contactObj = contact.toObject();

      // ✅ IMPORTANT: REMOVE _id so MongoDB creates new Lead document
      const newLead = await Lead.create({
        ...contactObj, // ✅ COPY ALL FIELDS
        isLead: true, // ✅ MARK AS LEAD
        firstname: firstname,
        lastname: lastname,
        status: status, // ✅ SET NEW STATUS
        createdBy: userId,

        activities: [
          ...(contactObj.activities || []),
          {
            action: "contact_converted_to_lead",
            type: "lead",
            title: "Contact Converted to Lead",
            description: `Converted after call with status "${status}"`,
          },
        ],
      });

      targetDoc = newLead;
      targetType = "convertedLead";

      // ✅ OPTIONAL: REMOVE OLD CONTACT IF YOU WANT
      await Contact.findByIdAndDelete(contact._id);
    } else {
      // ✅ NORMAL FLOW (NO CONVERSION)
      targetDoc = contact || lead;
      targetType = contact ? "contact" : lead ? "lead" : "newLead";
    }

    // ✅ 3. If NOT FOUND → Create New Lead
    if (!targetDoc) {
      const newID = new mongoose.Types.ObjectId();
      const newLead = await Lead.create({
        _id: newID,
        contact_id: newID,
        firstname: firstname,
        lastname: lastname,
        phoneNumbers: [
          {
            countryCode: countryCode,
            number: number,
          },
        ],
        status: status || "interested",
        notes: note || "",
        isLead: true,
        createdBy: userId,
        activities: [
          {
            action: "call_created",
            type: "call",
            title: "New Call Lead Created",
            description: `Call received from ${countryCode}${number}`,
          },
        ],
      });

      targetDoc = newLead;
      targetType = "newLead";
    }

    // ✅ 4. UPDATE STATUS
    if (status) {
      targetDoc.status = status;
    }

    if (firstname) {
      targetDoc.firstname = firstname;
    }

    if (lastname) {
      targetDoc.lastname = lastname;
    }

    // ✅ 5. ADD NOTE AS TASK
    if (note) {
      targetDoc.tasks.push({
        taskDescription: note,
        taskDueDate: new Date(),
        taskIsCompleted: false,
      });

      targetDoc.activities.push({
        action: "task_added",
        type: "task",
        title: "Call Note Added",
        description: note,
      });
    }

    if (meeting) {
      const timezone = meeting.timezone || "UTC";

      let meetingObj = {
        meeting_id: new mongoose.Types.ObjectId(),
        meetingTitle: meeting.meetingTitle || "Call Follow-up",
        meetingDescription: meeting.meetingDescription || "",
        meetingStartDate: meeting.meetingStartDate,
        meetingStartTime: meeting.meetingStartTime,
        meetingType: meeting.meetingType || "offline",
        meetingProvider: meeting.meetingProvider || null,
        meetingLocation: meeting.meetingLocation || "",
        meetingLink: "",
        createdAt: new Date(),
      };

      // -------------------------------------------------
      // ✅ ONLINE MEETING LOGIC (GOOGLE / ZOOM)
      // -------------------------------------------------
      if (meetingObj.meetingType === "online") {
        if (
          !meetingObj.meetingProvider ||
          !["google", "zoom"].includes(meetingObj.meetingProvider)
        ) {
          return res.status(400).json({
            message:
              "meetingProvider is required for online meetings (google / zoom)",
          });
        }

        // Date + Time required
        if (!meetingObj.meetingStartDate || !meetingObj.meetingStartTime) {
          return res.status(400).json({
            message: "Meeting date & time required for online meeting",
          });
        }

        // ---------------- GOOGLE ----------------
        if (meetingObj.meetingProvider === "google") {
          if (!loggedInUser?.googleAccessToken) {
            return res.status(400).json({
              message: "Connect Google account to create Google Meet",
            });
          }

          const link = await createGoogleMeetEvent(
            loggedInUser,
            meetingObj,
            timezone,
          );

          meetingObj.meetingLink = link;
          meetingObj.meetingLocation = undefined;
        }

        // ---------------- ZOOM ----------------
        if (meetingObj.meetingProvider === "zoom") {
          if (!loggedInUser?.zoom?.accessToken) {
            return res.status(400).json({
              message: "Connect Zoom account to create Zoom meeting",
            });
          }

          const zoomData = await createZoomMeeting(
            loggedInUser,
            meetingObj,
            timezone,
          );

          meetingObj.meetingLink = zoomData.joinUrl;
          meetingObj.meetingLocation = undefined;
        }
      }

      // -------------------------------------------------
      // ✅ OFFLINE MEETING
      // -------------------------------------------------
      if (meetingObj.meetingType === "offline") {
        meetingObj.meetingProvider = undefined;
        meetingObj.meetingLink = undefined;
      }

      // SAVE
      targetDoc.meetings.push(meetingObj);

      // Activity
      targetDoc.activities.push({
        action: "meeting_added",
        type: "meeting",
        title: meetingObj.meetingTitle || "Meeting Scheduled",
        description:
          meetingObj.meetingType === "online"
            ? `Online meeting via ${meetingObj.meetingProvider}`
            : "Offline meeting scheduled",
      });
    }
    console.log(loggedInUser.zoho?.accessToken, "loggedInUser.zoho?.accessToken1");
    console.log(loggedInUser.zoho?.refreshToken, "loggedInUser.zoho?.refreshToken1");

    // ✅ 7. SAVE FINAL DOCUMENT
    await targetDoc.save();
    console.log(loggedInUser.zoho?.accessToken, "loggedInUser.zoho?.accessToken2");
    console.log(loggedInUser.zoho?.refreshToken, "loggedInUser.zoho?.refreshToken2");
    if (loggedInUser.zoho?.accessToken && loggedInUser.zoho?.refreshToken) {
      console.log("Zoho sync block entered — triggering zohoAfterCallSync");
      console.log("Zoho credentials:", {
        hasAccessToken: !!loggedInUser.zoho?.accessToken,
        hasRefreshToken: !!loggedInUser.zoho?.refreshToken,
        isConnected: loggedInUser.zoho?.isConnected,
      });
      console.log("[Zoho] Calling zohoAfterCallSync with:", {
        phone: `+${rawCountry}${rawNumber}`,
        status,
        note,
        meeting,
      });
      try {
        await zohoAfterCallSync({
          user: loggedInUser,
          targetDoc,
          phone: `+${rawCountry}${rawNumber}`,
          status,
          note,
          meeting,
        });
      } catch (err) {
        console.error("[Zoho] After Call Sync Failed:", err.message, err.stack);
      }
    }

    if (
      loggedInUser.hubspot?.accessToken &&
      loggedInUser.hubspot?.isConnected
    ) {
      console.log(
        "[HubSpot] Sync block entered — triggering hubspotAfterCallSync",
      );
      const {
        hubspotAfterCallSync,
      } = require("../services/hubspotSync.service");

      try {
        await hubspotAfterCallSync({
          user: loggedInUser,
          targetDoc,
          phone: `+${rawCountry}${rawNumber}`,
          status,
          note,
          meeting,
        });
        console.log("[HubSpot] Sync completed successfully");
      } catch (err) {
        console.error("[HubSpot Sync Failed] Status:", err?.response?.status);
        console.error(
          "[HubSpot Sync Failed] Data:",
          JSON.stringify(err?.response?.data, null, 2),
        );
        console.error("[HubSpot Sync Failed] Message:", err.message);
        // ✅ Don't return error to client — sync failure shouldn't break the main response
      }
    }
    console.log("[Pipedrive Check]", {
      isConnected: loggedInUser.pipedrive?.isConnected,
      hasAccessToken: !!loggedInUser.pipedrive?.accessToken,
      hasRefreshToken: !!loggedInUser.pipedrive?.refreshToken,
    });
    // ✅ Add after HubSpot sync block
    if (loggedInUser.pipedrive?.accessToken && loggedInUser.pipedrive?.isConnected) {
      const { pipedriveAfterCallSync } = require("../services/pipedriveSync.service");

      try {
        await pipedriveAfterCallSync({
          user: loggedInUser,
          targetDoc,
          phone: `+${rawCountry}${rawNumber}`,
          status,
          note,
          meeting,
        });
        console.log("[Pipedrive] Sync completed successfully");
      } catch (err) {
        console.error("[Pipedrive Sync Failed] Status:", err?.response?.status);
        console.error("[Pipedrive Sync Failed] Data:", JSON.stringify(err?.response?.data, null, 2));
        console.error("[Pipedrive Sync Failed] Message:", err.message);
      }
    }

    return res.status(200).json({
      message: "Call form data saved successfully",
      type: targetType,
      data: targetDoc,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.findByPhoneNumber = async (req, res) => {
  try {
    const { phoneNumbers } = req.body;
    const loggedInUser = req.user;

    if (!phoneNumbers || !phoneNumbers.number) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const user = await User.findById(loggedInUser._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    /* ---------------------------------------------
       STEP 1: Prepare raw input
    --------------------------------------------- */

    let rawInput = "";
    let onlyNumberSearch = false;

    if (phoneNumbers.countryCode && phoneNumbers.number) {
      rawInput =
        "+" +
        String(phoneNumbers.countryCode).replace(/\D/g, "") +
        String(phoneNumbers.number).replace(/\D/g, "");
    } else {
      rawInput = String(phoneNumbers.number).replace(/\D/g, "");

      if (rawInput.startsWith("00")) {
        rawInput = "+" + rawInput.slice(2);
      } else if (rawInput.length > 10) {
        rawInput = "+" + rawInput;
      } else {
        // Local number (no country code)
        onlyNumberSearch = true;
      }
    }

    /* ---------------------------------------------
       STEP 2: Allowed User IDs
    --------------------------------------------- */

    let allowedUserIds = [];

    if (user.role === "user") {
      allowedUserIds = [loggedInUser._id];
    }

    if (user.role === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: loggedInUser._id,
      }).select("_id");

      allowedUserIds = [loggedInUser._id, ...agents.map((a) => a._id)];
    }

    /* ---------------------------------------------
       STEP 3: Try Parsing (if not local-only)
    --------------------------------------------- */

    let phoneQuery;

    if (!onlyNumberSearch) {
      let parsedPhone;

      if (rawInput.startsWith("+")) {
        parsedPhone = parsePhoneNumberFromString(rawInput);
      } else {
        parsedPhone = parsePhoneNumberFromString(rawInput, "IN");
      }

      if (parsedPhone && parsedPhone.isValid()) {
        const normalizedCountryCode = parsedPhone.countryCallingCode;
        const normalizedNumber = parsedPhone.nationalNumber;

        phoneQuery = {
          phoneNumbers: {
            $elemMatch: {
              countryCode: normalizedCountryCode,
              number: normalizedNumber,
            },
          },
          createdBy: { $in: allowedUserIds },
        };
      } else {
        // Parsing failed → fallback to number only search
        onlyNumberSearch = true;
      }
    }

    /* ---------------------------------------------
       STEP 4: Fallback → Search only by number
    --------------------------------------------- */

    if (onlyNumberSearch) {
      const cleanNumber = String(phoneNumbers.number).replace(/\D/g, "");

      phoneQuery = {
        "phoneNumbers.number": cleanNumber,
        createdBy: { $in: allowedUserIds },
      };
    }

    /* ---------------------------------------------
       STEP 5: Search DB
    --------------------------------------------- */

    const [contact, lead] = await Promise.all([
      Contact.findOne(phoneQuery),
      Lead.findOne(phoneQuery),
    ]);

    if (!contact && !lead) {
      return res.status(200).json({
        success: true,
        message: "No contact or lead found",
        data: {},
      });
    }

    return res.status(200).json({
      success: true,
      message: "Contact/Lead found",
      data: contact || lead,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
// const { getConfig } = require("../utils/getConfig");

const lambdaClient = new LambdaClient({
  region: "eu-north-1",
});

exports.incomingCallWebhook = async (req, res) => {
  try {
    const userId = req.user._id;

    const connections = await incomingcallConnection.find({ userId });

    const payload = {
      userId,
      message: "Incoming Call",
    };

    // Lambda invocation is best-effort (push notification to other connected
    // clients). We intentionally do NOT await it inside the main try/catch so
    // that a missing AWS credential locally, or a transient Lambda error in
    // production, never causes this endpoint to return 500.
    lambdaClient
      .send(
        new InvokeCommand({
          FunctionName: "incomingcall-connect",
          InvocationType: "Event",
          Payload: JSON.stringify({
            action: "incomingcall",
            connections: connections.map((c) => c.connectionId),
            payload,
          }),
        }),
      )
      .catch((lambdaErr) => {
        // Log but do not propagate — Lambda is non-critical for this response
        console.warn("Lambda incomingcall-connect invocation failed:", lambdaErr.message);
      });

    return res.status(200).json({ message: "Webhook received successfully" });
  } catch (error) {
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};
