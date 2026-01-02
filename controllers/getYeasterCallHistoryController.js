const axios = require("axios");
// const moment = require("moment");
const mongoose = require("mongoose");
const https = require("https");
const { getValidToken } = require("../utils/yeastarClient");
const User = require("../models/userModel"); // make sure to import
const CallHistory = require("../models/CallHistory");
const moment = require("moment-timezone");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const { zohoAfterCallSync } = require("../services/zohoAfterCallSync.service");


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

exports.fetchAndStoreCallHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const token = await getValidToken();
    console.log(userId);
    console.log(token);

    const user = await User.findById(userId);
    if (!user || !user.extensionNumber) {
      return res.status(400).json({
        success: false,
        message: "User extension not found",
      });
    }

    const ext = user.extensionNumber;

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

    console.log("Using Yeastar TZ:", TZ);
    console.log("startTime:", startTime, "endTime:", endTime);

    // -------- OUTBOUND --------
    const urlFrom = `${YEASTAR_BASE_URL}/cdr/search?access_token=${token}&call_from=${ext}&start_time=${encodedStart}&end_time=${encodedEnd}`;
    const respFrom = await axios.get(urlFrom, {
      httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
    });

    // -------- INBOUND --------
    const urlTo = `${YEASTAR_BASE_URL}/cdr/search?access_token=${token}&call_to=${ext}&start_time=${encodedStart}&end_time=${encodedEnd}`;
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

      console.log(from_number, to_number);

      console.log(call.time);

      const dubaiFormatted = moment
        .tz(call.time, "MM/DD/YYYY HH:mm:ss", TZ)
        .format("MM/DD/YYYY HH:mm:ss");

      console.log(dubaiFormatted);

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
    console.log("Error:", err.response?.data || err.message);
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

    // 1️⃣ Fetch logged-in company admin
    const admin = await User.findById(loginUserId).select(
      "_id firstname lastname extensionNumber role"
    );

    if (!admin) {
      return res.status(400).json({
        status: "error",
        message: "Company admin not found",
      });
    }

    const adminExtension = admin.extensionNumber;

    // 2️⃣ Request filters
    const {
      page = 1,
      page_size = 20,
      search = "",
      status = [],
      callType = [],
      startDate = "",
      endDate = "",
      agentId = "",
    } = req.body;

    // 3️⃣ Decide whose calls to show
    let finalExtension = adminExtension; // default → show only admin calls
    let agentName = `${admin.firstname} ${admin.lastname}`;

    // if (agentId) {
    //   // Validate agent belongs to this company admin
    //   const agent = await User.findOne({
    //     _id: agentId,
    //     createdByWhichCompanyAdmin: loginUserId   // ensure it's this admin's agent
    //   }).select("firstname lastname extensionNumber");

    //   if (!agent) {
    //     return res.status(400).json({
    //       status: "error",
    //       message: "Invalid agentId or agent not under this company admin"
    //     });
    //   }

    //   finalExtension = agent.extensionNumber;
    //   agentName = `${agent.firstname} ${agent.lastname}`;
    // }

    // --- support multiple agent ids (agentId can be string or array) ---
    let agentIdsArray = [];

    // normalize input: if agentId is an array use it, if string convert to single-element array
    if (agentId) {
      if (Array.isArray(agentId)) {
        agentIdsArray = agentId;
      } else {
        agentIdsArray = [agentId];
      }
    }

    // If agentIdsArray provided, fetch agents and validate they belong to this admin
    let agentExtensions = [adminExtension]; // default - show admin extension only
    let agentMap = {}; // map extension -> agent name (for attaching to records)

    if (agentIdsArray.length > 0) {
      // get agents that belong to this admin and match provided ids
      const agents = await User.find({
        _id: { $in: agentIdsArray },
        createdByWhichCompanyAdmin: loginUserId,
      }).select("firstname lastname extensionNumber");

      if (!agents || agents.length === 0) {
        return res.status(400).json({
          status: "error",
          message:
            "No valid agents found for provided agentId(s) or they are not under this company admin",
        });
      }

      // prepare extension list and map names
      agentExtensions = agents.map((a) => a.extensionNumber);
      agents.forEach((a) => {
        agentMap[a.extensionNumber] = `${a.firstname} ${a.lastname}`;
      });
    }

    // // 4️⃣ Base query (very important: ONLY ONE extension)
    // let query = {
    //   extensionNumber: agentExtensions,
    // };

    // 4️⃣ Base query (USER BASED FILTER — NOT EXTENSION BASED)
    let query = {};

    if (agentIdsArray.length > 0) {
      // ✅ Multiple agents selected → filter by their userIds
      query.extensionNumber = agentExtensions;
      query.userId = { $in: agentIdsArray };
    } else {
      // ✅ No agent selected → only show company admin calls
      query.extensionNumber = agentExtensions;
      query.userId = loginUserId;
    }

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
        internal: "Internal",
      };

      const mapped = callType.map((t) => typeMap[t]).filter(Boolean);

      if (mapped.length > 0) {
        query.direction = { $in: mapped };
      }
    }

    // // 8️⃣ Date Filter
    // if (startDate && endDate) {
    //   query.start_time = {
    //     $gte: new Date(startDate),
    //     $lte: new Date(endDate)
    //   };
    // }

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

    console.log();

    // 🔟 Summary filter
    // const summaryFilter = { extensionNumber: finalExtension };

    // 🔟 Summary filter (SAME AS MAIN QUERY but WITHOUT PAGINATION)
    let summaryFilter = {};

    // if (agentIdsArray.length > 0) {
    //   summaryFilter.userId = { $in: agentIdsArray };
    //   summaryFilter.extensionNumber = finalExtension;
    // } else {
    summaryFilter.extensionNumber = finalExtension;
    summaryFilter.userId = loginUserId;
    // }

    // if (query.direction) summaryFilter.direction = query.direction;
    // if (query.status) summaryFilter.status = query.status;
    // if (query.start_time) summaryFilter.start_time = query.start_time;

    const inbound = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Inbound",
    });

    const outbound = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Outbound",
    });

    const internal = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Internal",
    });

    const missed = await CallHistory.countDocuments({
      ...summaryFilter,
      status: "NO ANSWER",
    });

    const total = inbound + outbound + internal;

    // 1️⃣1️⃣ Add agentName to each record
    const finalData = callRecords.map((c) => ({
      ...c._doc,
      agentName,
    }));

    return res.json({
      status: "success",
      summary: {
        inboundCalls: inbound,
        internal,
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
    console.error("❌ CompanyAdmin Get Call History Error:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve call history",
      error: err.message,
    });
  }
};

exports.getAgentCallHistory = async (req, res) => {
  try {
    const loginUserId = req.user._id;

    // 1️⃣ Fetch logged-in company admin
    const agent = await User.findById(loginUserId).select(
      "_id firstname lastname extensionNumber role"
    );

    if (!agent) {
      return res.status(400).json({
        status: "error",
        message: "agent admin not found",
      });
    }

    const agentExtension = agent.extensionNumber;

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
        internal: "Internal",
      };

      const mapped = callType.map((t) => typeMap[t]).filter(Boolean);

      if (mapped.length > 0) {
        query.direction = { $in: mapped };
      }
    }

    // // 8️⃣ Date Filter
    // if (startDate && endDate) {
    //   query.start_time = {
    //     $gte: new Date(startDate),
    //     $lte: new Date(endDate)
    //   };
    // }

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

    // if (query.direction) summaryFilter.direction = query.direction;
    // if (query.status) summaryFilter.status = query.status;
    // if (query.start_time) summaryFilter.start_time = query.start_time;

    const inbound = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Inbound",
    });

    const outbound = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Outbound",
    });

    const internal = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Internal",
    });

    const missed = await CallHistory.countDocuments({
      ...summaryFilter,
      status: "NO ANSWER",
    });

    const total = inbound + outbound + internal;

    // 1️⃣1️⃣ Add agentName to each record
    const finalData = callRecords.map((c) => ({
      ...c._doc,
      agentName,
    }));

    return res.json({
      status: "success",
      summary: {
        inboundCalls: inbound,
        internal,
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
    console.error("❌ CompanyAdmin Get Call History Error:", err);
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

    // ✅ 1️⃣ Get logged-in admin
    const admin = await User.findById(loginUserId).select(
      "_id firstname lastname extensionNumber role"
    );

    if (!admin) {
      return res.status(400).json({
        status: "error",
        message: "Company admin not found",
      });
    }

    const adminExtension = admin.extensionNumber;

    // ✅ 2️⃣ Request body
    const {
      page = 1,
      page_size = 20,
      search = "",
      status = [],
      callType = [],
      startDate = "",
      endDate = "",
      phonenumbers = [],
    } = req.body;

    if (!Array.isArray(phonenumbers) || phonenumbers.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Phone numbers list is required",
      });
    }

    // ✅ 3️⃣ UNIVERSAL PHONE NORMALIZER
    const normalizePhone = (phone) => {
      if (!phone) return "";
      return phone
        .toString()
        .replace(/\s+/g, "")
        .replace(/[^0-9]/g, "")
        .replace(/^00/, "");
    };

    // ✅ 4️⃣ BUILD ALL POSSIBLE PHONE VARIATIONS
    const flatNumbers = new Set();

    phonenumbers.forEach((p) => {
      const raw = normalizePhone(p.number); // 558894938
      const cc = normalizePhone(p.countryCode); // 971

      if (!raw) return;

      flatNumbers.add(raw); // 558894938
      flatNumbers.add("0" + raw); // 0558894938

      if (cc) {
        flatNumbers.add(cc + raw); // 971558894938
        flatNumbers.add(cc + "0" + raw); // 9710558894938
      }
    });

    const normalizedNumbers = [...flatNumbers];

    // ✅ 5️⃣ BASE PHONE FILTER QUERY (MAIN LOGIC)
    let query = {
      userId: loginUserId, // ✅ FILTER BY LOGGED-IN USER
      extensionNumber: adminExtension, // ✅ FILTER BY EXTENSION
      $expr: {
        $or: [
          {
            $and: [
              {
                $in: [
                  {
                    $replaceAll: {
                      input: {
                        $replaceAll: {
                          input: "$call_from",
                          find: " ",
                          replacement: "",
                        },
                      },
                      find: "+",
                      replacement: "",
                    },
                  },
                  normalizedNumbers,
                ],
              },
              { $eq: ["$call_to", adminExtension] },
            ],
          },
          {
            $and: [
              { $eq: ["$call_from", adminExtension] },
              {
                $in: [
                  {
                    $replaceAll: {
                      input: {
                        $replaceAll: {
                          input: "$call_to",
                          find: " ",
                          replacement: "",
                        },
                      },
                      find: "+",
                      replacement: "",
                    },
                  },
                  normalizedNumbers,
                ],
              },
            ],
          },
        ],
      },
    };

    // ✅ 6️⃣ SEARCH FILTER
    if (search.trim()) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { call_from: { $regex: search, $options: "i" } },
          { call_to: { $regex: search, $options: "i" } },
        ],
      });
    }

    // ✅ 7️⃣ STATUS FILTER
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

    // ✅ 8️⃣ CALL TYPE FILTER
    if (Array.isArray(callType) && callType.length > 0) {
      const typeMap = {
        inbound: "Inbound",
        outbound: "Outbound",
        internal: "Internal",
      };

      const mapped = callType.map((t) => typeMap[t]).filter(Boolean);
      if (mapped.length > 0) {
        query.direction = { $in: mapped };
      }
    }

    // ✅ 9️⃣ DATE FILTER (SAFE FOR STRING DATABASE)
    if (startDate && endDate) {
      query.$and = query.$and || [];
      query.$and.push({
        $expr: {
          $and: [
            {
              $gte: [
                {
                  $dateFromString: {
                    dateString: "$start_time",
                    format: "%m/%d/%Y %H:%M:%S",
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
                    onError: new Date("2999-01-01"),
                    onNull: new Date("2999-01-01"),
                  },
                },
                new Date(endDate),
              ],
            },
          ],
        },
      });
    }

    // ✅ 🔟 PAGINATION
    const skip = (page - 1) * page_size;

    const totalRecords = await CallHistory.countDocuments(query);

    const callRecords = await CallHistory.find(query)
      .sort({ start_time: -1 })
      .skip(skip)
      .limit(page_size);

    // // ✅ 1️⃣1️⃣ SUMMARY (USES SAME FILTER = ALWAYS ACCURATE)
    // const allSummaryCalls = await CallHistory.find(query).select("direction status");

    // let inboundCalls = 0;
    // let outboundCalls = 0;
    // let missedCalls = 0;

    // allSummaryCalls.forEach(call => {
    //   if (call.direction === "Inbound") inboundCalls++;
    //   if (call.direction === "Outbound") outboundCalls++;
    //   if (call.status === "NO ANSWER") missedCalls++;
    // });

    // const totalCalls = inboundCalls + outboundCalls;

    // const summary = {
    //   inboundCalls,
    //   outboundCalls,
    //   missedCalls,
    //   totalCalls
    // };

    // ✅ 1️⃣1️⃣ SUMMARY (PHONE-ONLY, IGNORE OTHER REQ FILTERS)
    // Build a phone-only $expr exactly like the base filter but WITHOUT
    // the other request-driven filters (search, status, callType, date).
    const phoneOnlyExpr = {
      $or: [
        {
          $and: [
            {
              $in: [
                {
                  $replaceAll: {
                    input: {
                      $replaceAll: {
                        input: "$call_from",
                        find: " ",
                        replacement: "",
                      },
                    },
                    find: "+",
                    replacement: "",
                  },
                },
                normalizedNumbers,
              ],
            },
            { $eq: ["$call_to", adminExtension] },
          ],
        },
        {
          $and: [
            { $eq: ["$call_from", adminExtension] },
            {
              $in: [
                {
                  $replaceAll: {
                    input: {
                      $replaceAll: {
                        input: "$call_to",
                        find: " ",
                        replacement: "",
                      },
                    },
                    find: "+",
                    replacement: "",
                  },
                },
                normalizedNumbers,
              ],
            },
          ],
        },
      ],
    };

    // phoneOnlyQuery only filters by phone variations (ignores search/status/type/date)
    const phoneOnlyQuery = {
      userId: loginUserId, // ✅ FILTER BY LOGGED-IN USER
      extensionNumber: adminExtension, // ✅ FILTER BY EXTENSION
      $expr: phoneOnlyExpr,
    };

    // Get all matching calls for the phone(s) — used only for the summary counts.
    const allSummaryCalls = await CallHistory.find(phoneOnlyQuery).select(
      "direction status"
    );

    let inboundCalls = 0;
    let outboundCalls = 0;
    let missedCalls = 0;

    allSummaryCalls.forEach((call) => {
      if (call.direction === "Inbound") inboundCalls++;
      if (call.direction === "Outbound") outboundCalls++;
      if (call.status === "NO ANSWER") missedCalls++;
    });

    const totalCalls = inboundCalls + outboundCalls;

    const summary = {
      inboundCalls,
      outboundCalls,
      missedCalls,
      totalCalls,
    };

    // ✅ ✅ ✅ FINAL RESPONSE
    return res.json({
      status: "success",
      summary,
      page,
      page_size,
      totalRecords,
      callRecords,
    });
  } catch (err) {
    console.error("❌ PhoneNumber Call History Error:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve phone number call history",
      error: err.message,
    });
  }
};

exports.callRecordingDownload = async (req, res) => {
  try {
    const { record_file } = req.body;
    const token = await getValidToken();

    if (!record_file) {
      return res.status(400).json({
        status: "error",
        message: "record_file is required",
      });
    }

    // ---- STEP 1 ----
    // Correct API URL based on your working Postman request
    const url1 = `${YEASTAR_BASE_URL}/recording/download?access_token=${token}&file=${encodeURIComponent(
      record_file
    )}`;

    const step1 = await axios.get(url1);
    console.log(step1);

    if (!step1.data.download_resource_url) {
      return res.status(500).json({
        status: "error",
        message: "Yeastar did not return download_resource_url",
        yeastarResponse: step1.data,
      });
    }

    const downloadPath = step1.data.download_resource_url;
    const url2 = `https://cmedia.ras.yeastar.com${downloadPath}?access_token=${token}`;

    return res.json({
      status: "success",
      fileName: record_file,
      mimeType: "audio/wav",
      fileUrl: url2,
    });
  } catch (err) {
    console.error("❌ Call Recording Download Error:", err);
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
    // const calls = await CallHistory.find({
    //   userId: { $in: userIdsToInclude },   // <-- filter by userIds
    //   start_time: { $gte: startDate, $lt: endDate }
    // }).select("start_time direction");

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
      // const d = new Date(call.start_time);

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
    console.error("Error:", error);
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

    // 4️⃣ Fetch calls
    // const calls = await CallHistory.find({
    //   userId: { $in: userIdsToSearch },
    //   start_time: { $gte: startDate, $lte: endDate },
    // }).select("start_time direction status");

    // 4️⃣ Fetch calls (safe for start_time stored as STRING "MM/DD/YYYY HH:mm:ss")
    // Converts start_time -> Date using $dateFromString, safely handles nulls/mixed types.
    const calls = await CallHistory.find({
      userId: { $in: userIdsToSearch },
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
    console.error("Error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.addFormDataAfterCallEnd = async (req, res) => {
  try {
    console.log("data saving...");
    
    const { phoneNumbers, firstname, lastname, status, note, meeting } =
      req.body;
    console.log("status sent", status);
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
    // let contact = await Contact.findOne({
    //   createdBy: userId,
    //   "phoneNumbers.countryCode": rawCountry,
    //   "phoneNumbers.number": rawNumber,
    // });

    let contact = await Contact.findOne({
      createdBy: { $in: allowedUserIds },
      "phoneNumbers.countryCode": rawCountry,
      "phoneNumbers.number": rawNumber,
    });

    // let lead = await Lead.findOne({
    //   createdBy: userId,
    //   "phoneNumbers.countryCode": rawCountry,
    //   "phoneNumbers.number": rawNumber,
    // });

    let lead = await Lead.findOne({
      createdBy: { $in: allowedUserIds },
      "phoneNumbers.countryCode": rawCountry,
      "phoneNumbers.number": rawNumber,
    });

    // let targetDoc = contact || lead;
    // let targetType = contact ? "contact" : lead ? "lead" : "newLead";

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
      // delete contactObj._id;

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

    if (firstname && lastname) {
      targetDoc.firstname = firstname;
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

    // ✅ 6. ADD MEETING
    if (meeting) {
      targetDoc.meetings.push({
        meetingTitle: meeting.meetingTitle || "Call Follow-up",
        meetingDescription: meeting.meetingDescription || "",
        meetingStartDate: meeting.meetingStartDate,
        meetingStartTime: meeting.meetingStartTime,
        meetingType: meeting.meetingType || "offline",
        meetingLink: meeting.meetingLink || "",
        meetingLocation: meeting.meetingLocation || "",
      });

      targetDoc.activities.push({
        action: "meeting_added",
        type: "meeting",
        title: meeting.meetingTitle || "Meeting Scheduled",
        description: "Meeting created after call",
      });
    }

    // ✅ 7. SAVE FINAL DOCUMENT
    await targetDoc.save();

    if (loggedInUser.zoho?.accessToken && loggedInUser.zoho?.refreshToken) {
      console.log("hello");
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
    console.error("❌ addFormDataAfterCallEnd Error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};
