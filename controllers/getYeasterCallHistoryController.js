const axios = require("axios");
// const moment = require("moment");
const mongoose = require("mongoose");
const https = require("https");
const { getValidToken } = require("../utils/yeastarClient");
const { getDeviceToken } = require("../services/yeastarTokenService");
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

//show all calls of number agent and company admin calls, show proper agent ya company admin name in call,extention is change so call is not show

const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL;
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

  return number
    .toString()
    .replace(/\s+/g, "") // remove spaces
    .replace(/^\+/, "") // remove leading +
    .replace(/\D/g, ""); // remove all non-digits
}

// ======================================================
// 📞 Extract countryCode + number (Global support)
// ======================================================
function extractNumberDetails(rawNumber) {

  if (!rawNumber) return null;

  const parsed = parsePhoneNumberFromString("+" + rawNumber);

  // If parsing fails → fallback last 10 digits
  if (!parsed) {
    return {
      countryCode: null,
      number: rawNumber.slice(-10),
    };
  }

  return {
    countryCode: parsed.countryCallingCode,
    number: parsed.nationalNumber,
  };
}

// ======================================================
// 🔍 Find Contact / Lead (Flexible match)
// ======================================================
async function findRecord(details, userId) {

  if (!details?.number) return null;

  // 1️⃣ Full match (country + number)
  let contact = await Contact.findOne({
    phoneNumbers: {
      $elemMatch: {
        countryCode: details.countryCode,
        number: details.number,
      },
    },
    createdBy: userId,
  });

  let lead = null;

  if (!contact) {
    lead = await Lead.findOne({
      phoneNumbers: {
        $elemMatch: {
          countryCode: details.countryCode,
          number: details.number,
        },
      },
      createdBy: userId,
    });
  }

  // 2️⃣ If not found → match only number
  if (!contact && !lead) {

    contact = await Contact.findOne({
      "phoneNumbers.number": details.number,
      createdBy: userId,
    });

    if (!contact) {
      lead = await Lead.findOne({
        "phoneNumbers.number": details.number,
        createdBy: userId,
      });
    }
  }

  return contact || lead || null;
}

exports.fetchAndStoreCallHistory = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user || !user.PBXDetails.PBX_EXTENSION_NUMBER) {
      return res.status(400).json({
        success: false,
        message: "User extension not found",
      });
    }

    const ext = user.PBXDetails.PBX_EXTENSION_NUMBER;
    const PBX_BASE_URL = user.PBXDetails.PBX_BASE_URL;
    const deviceId = user.PBXDetails.assignedDeviceId;
    const token = await getDeviceToken(deviceId, "pbx");
    // Always use Yeastar PBX timezone
    const TZ = process.env.YEASTAR_TZ || "Asia/Dubai";

    // Build time window in Yeastar timezone
    const endMoment = moment().tz(TZ);
    const startMoment = endMoment.clone().subtract(24, "hours");

    // Yeastar required format
    const startTime = startMoment.format("MM/DD/YYYY HH:mm:ss");
    const endTime = endMoment.format("MM/DD/YYYY HH:mm:ss");

    const encodedStart = encodeURIComponent(startTime);
    const encodedEnd = encodeURIComponent(endTime);

    // -------- OUTBOUND --------
    const urlFrom = `${PBX_BASE_URL}/cdr/search?access_token=${token}&call_from=${ext}&start_time=${encodedStart}&end_time=${encodedEnd}`;
    const respFrom = await axios.get(urlFrom, {
      httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
    });

    // -------- INBOUND --------
    const urlTo = `${PBX_BASE_URL}/cdr/search?access_token=${token}&call_to=${ext}&start_time=${encodedStart}&end_time=${encodedEnd}`;
    const respTo = await axios.get(urlTo, {
      httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
    });

    const fromList = Array.isArray(respFrom.data?.data)
      ? respFrom.data.data
      : [];
    const toList = Array.isArray(respTo.data?.data) ? respTo.data.data : [];

    let finalList = [...fromList, ...toList];

    // Remove duplicates
    const map = new Map();
    finalList.forEach((c) => map.set(c.id, c));
    finalList = [...map.values()];

    let inserted = 0;

    for (const call of finalList) {
      const exists = await CallHistory.findOne({ yeastarId: call.id });
      if (exists) continue;

      const from_number = normalizeNumber(call.call_from_number);
      const to_number = normalizeNumber(call.call_to_number);

      // ==========================================
      // 📞 Parse FROM & TO numbers
      // ==========================================
      const fromDetails = extractNumberDetails(from_number);
      const toDetails = extractNumberDetails(to_number);

      // ==========================================
      // 🔍 Find matching records
      // ==========================================
      const fromRecord = await findRecord(fromDetails, userId);
      const toRecord = await findRecord(toDetails, userId);

      const dubaiFormatted = moment
        .tz(call.time, "MM/DD/YYYY HH:mm:ss", TZ)
        .format("MM/DD/YYYY HH:mm:ss");

      await CallHistory.create({
        userId,
        extensionNumber: ext,
        yeastarId: call.id,

        call_from: from_number,
        call_to: to_number,

        talk_time: call.talk_duration,
        ring_time: call.ring_duration,
        duration: call.duration,

        direction: call.call_type,
        status: call.disposition,

        start_time: dubaiFormatted,
        end_time: dubaiFormatted,

        record_file: call.record_file,
        disposition_code: call.reason,
        trunk: call.dst_trunk,
      });

      // ==========================================
      // 📝 Prepare Activity
      // ==========================================
      const baseActivity = {
        action: "Call activity",
        type: "call",
        title:
          call.call_type === "Outbound"
            ? "Outgoing Call"
            : "Incoming Call",
        description: `Call ${call.disposition} | Duration: ${call.duration}s`,
        timestamp: dubaiFormatted,
      };

      // ==========================================
      // 💾 Store FROM activity
      // ==========================================
      if (fromRecord) {

        fromRecord.activities.push({
          ...baseActivity,
          description: `Call with ${to_number} | ${call.disposition}`,
        });

        await fromRecord.save();
      }

      // ==========================================
      // 💾 Store TO activity
      // ==========================================
      if (toRecord) {

        toRecord.activities.push({
          ...baseActivity,
          description: `Call with ${from_number} | ${call.disposition}`,
        });

        await toRecord.save();
      }

      inserted++;
    }

    return res.json({
      status: "success",
      userId,
      extension: ext,
      time_window: { startTime, endTime },
      totalFetched: finalList.length,
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

    const allUserIds = [admin._id, ...agents.map(a => a._id)];

    // ------------------------------------
    // 2️⃣ RECORD USER FILTER (agentId)
    // ------------------------------------
    let recordUserIds = allUserIds;

    if (Array.isArray(agentId) && agentId.length) {
      recordUserIds = agentId.map(id => new mongoose.Types.ObjectId(id));
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
        $in: status.map(s => map[s]).filter(Boolean),
      };
    }

    if (callType.length) {
      const map = {
        inbound: "Inbound",
        outbound: "Outbound",
        // internal: "Internal",
      };
      recordMatch.direction = {
        $in: callType.map(t => map[t]).filter(Boolean),
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
          pipeline: [
            { $project: { firstname: 1, lastname: 1, role: 1 } },
          ],
          as: "owner",
        },
      },
      { $unwind: "$owner" },

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

    const recordResult = await CallHistory.aggregate(recordsPipeline);

    const callRecords = recordResult[0]?.records || [];
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
        totalCalls:
          summary.inbound + summary.outbound,
        // + summary.internal,
      },
      page,
      page_size,
      totalRecords,
      callRecords,
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
      "_id firstname lastname extensionNumber role PBXDetails"
    );

    if (!agent) {
      return res.status(400).json({
        status: "error",
        message: "agent admin not found",
      });
    }

    const agentExtension = agent.PBXDetails.PBX_EXTENSION_NUMBER;

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
      extensionNumber: finalExtension,
      userId: loginUserId,
    };

    // ❌ Exclude Internal calls globally
    query.direction = { $ne: "Internal" };

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
    if (startDate && endDate) {
      query.$expr = {
        $and: [
          {
            $gte: [
              {
                $dateFromString: {
                  dateString: { $toString: "$start_time" }, // ✅ forces to string
                  format: "%m/%d/%Y %H:%M:%S",
                  onError: new Date("1970-01-01"), // ✅ prevents crash
                  onNull: new Date("1970-01-01"), // ✅ prevents crash
                },
              },
              new Date(startDate),
            ],
          },
          {
            $lte: [
              {
                $dateFromString: {
                  dateString: { $toString: "$start_time" }, // ✅ forces to string
                  format: "%m/%d/%Y %H:%M:%S",
                  onError: new Date("2999-01-01"), // ✅ prevents crash
                  onNull: new Date("2999-01-01"), // ✅ prevents crash
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

    // 🔟 Summary filter
    const summaryFilter = {
      extensionNumber: finalExtension,
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
    const finalData = callRecords.map((c) => ({
      ...c._doc,
      agentName,
    }));

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
      "_id firstname lastname role createdByWhichCompanyAdmin"
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

      allowedUserIds = [loginUser._id, ...agents.map(a => a._id)];
    } else {
      allowedUserIds = [loginUser._id];
    }

    /* 📞 PHONE NORMALIZATION */
    const normalize = v => v?.toString().replace(/\D/g, "") || "";

    const phoneSet = new Set();
    phonenumbers.forEach(p => {
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
          $or: [
            { call_from: { $in: phones } },
            { call_to: { $in: phones } },
          ],
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
            $in: status.map(s => statusMap[s]).filter(Boolean),
          },
        },
      });
    }

    /* 🔁 CALL TYPE FILTER */
    if (callType.length) {
      pipeline.push({
        $match: {
          direction: {
            $in: callType.map(t => typeMap[t]).filter(Boolean),
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

    summaryCalls.forEach(c => {
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
    // const token = await getValidToken();

    if (!record_file) {
      return res.status(400).json({
        status: "error",
        message: "record_file is required",
      });
    }

    // ---- STEP 1 ----
    // Correct API URL based on your working Postman request
    const url1 = `${PBX_BASE_URL}/recording/download?access_token=${token}&file=${encodeURIComponent(
      record_file
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

    const MEDIA_BASE_URL =
      getMediaBaseUrl(PBX_BASE_URL);

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
      "role createdByWhichCompanyAdmin"
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
    // DATE RANGE: TODAY → LAST 30 DAYS
    // ------------------------------

    const today = new Date();

    const endDate = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + 1, // next day at 00:00
        0,
        0,
        0
      )
    );

    const startDate = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - 29,
        0,
        0,
        0
      )
    );

    // ------------------------------
    // FETCH CALLS
    // ------------------------------

    const calls = await CallHistory.find({
      userId: { $in: userIdsToInclude },
      $expr: {
        $and: [
          {
            $gte: [
              {
                $dateFromString: {
                  dateString: { $toString: "$start_time" },
                  format: "%m/%d/%Y %H:%M:%S",
                  onError: new Date("1970-01-01"),
                  onNull: new Date("1970-01-01"),
                },
              },
              startDate,
            ],
          },
          {
            $lt: [
              {
                $dateFromString: {
                  dateString: { $toString: "$start_time" },
                  format: "%m/%d/%Y %H:%M:%S",
                  onError: new Date("2999-01-01"),
                  onNull: new Date("2999-01-01"),
                },
              },
              endDate,
            ],
          },
        ],
      },
    }).select("start_time direction");

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
    // BUILD EMPTY LAST-30-DAYS ARRAY
    // ------------------------------
    const daysArray = [];

    for (let i = 0; i < 30; i++) {
      const d = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() - i
        )
      );

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
      const d = new Date(
        call.start_time.replace(/(\d{2})\/(\d{2})\/(\d{4})/, "$3-$1-$2")
      );

      const diffDays = Math.floor((endDate - d) / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays < 30) {
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
    return res.json({
      status: "success",
      range: {
        start: formatDate(startDate),
        end: formatDate(today),
      },
      days: daysArray.reverse(), // earliest → latest
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
      "_id role createdByWhichCompanyAdmin"
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

    // 4️⃣ Fetch calls (safe for start_time stored as STRING "MM/DD/YYYY HH:mm:ss")
    // Converts start_time -> Date using $dateFromString, safely handles nulls/mixed types.
    const calls = await CallHistory.find({
      userId: { $in: userIdsToSearch },
      direction: { $ne: "Internal" },
      $expr: {
        $and: [
          {
            $gte: [
              {
                $dateFromString: {
                  dateString: {
                    $trim: { input: { $toString: "$start_time" } },
                  },
                  format: "%m/%d/%Y %H:%M:%S",
                  onError: null,
                  onNull: null,
                },
              },
              startDate,
            ],
          },
          {
            $lte: [
              {
                $dateFromString: {
                  dateString: {
                    $trim: { input: { $toString: "$start_time" } },
                  },
                  format: "%m/%d/%Y %H:%M:%S",
                  onError: null,
                  onNull: null,
                },
              },
              endDate,
            ],
          },
        ],
      },
    }).select("start_time direction status userId");

    // 7️⃣ Summary counts
    const inboundTotal = calls.filter((c) => c.direction === "Inbound").length;
    const outboundTotal = calls.filter(
      (c) => c.direction === "Outbound"
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

    // -----------------------------------------------
    // ⭐ NEW: Determine company admin and agent group
    // -----------------------------------------------
    const loggedInUser = await User.findById(userId);

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
            timezone
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
            timezone
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

    // ✅ 7. SAVE FINAL DOCUMENT
    await targetDoc.save();

    if (loggedInUser.zoho?.accessToken && loggedInUser.zoho?.refreshToken) {
      zohoAfterCallSync({
        user: loggedInUser,
        targetDoc,
        // phone: `${rawCountry}${rawNumber}`,
        phone: `+${rawCountry}${rawNumber}`,
        status,
        note,
        meeting,
      }).catch((err) => {
        console.error("Zoho After Call Sync Failed:", err.message);
      });
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

      allowedUserIds = [
        loggedInUser._id,
        ...agents.map((a) => a._id),
      ];
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

const lambdaClient = new LambdaClient({
  region: "eu-north-1"
});

exports.incomingCallWebhook = async (req, res) => {
  try {
    const userId = req.user._id;

    const connections = await incomingcallConnection.find({ userId });


    const payload = {
      userId,
      message: "Incoming Call",
    };


    const responce = await lambdaClient.send(new InvokeCommand({
      FunctionName: "incomingcall-connect",
      InvocationType: "Event",
      Payload: JSON.stringify({
        action: "incomingcall",
        connections: connections.map(c => c.connectionId),
        payload,
      })
    }));

    // You can process the incoming call data here
    // For example, save it to the database or trigger other actions
    return res.status(200).json({ message: "Webhook received successfully" });
  } catch (error) {
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};