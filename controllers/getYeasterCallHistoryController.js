const axios = require("axios");
// const moment = require("moment");
const https = require("https");
const { getValidToken } = require("../utils/yeastarClient");
const User = require("../models/userModel"); // make sure to import
const CallHistory = require("../models/CallHistory");
const moment = require("moment-timezone");

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

// exports.fetchAndStoreCallHistory = async (req, res) => {
//   try {
//     const userId = req.user._id; // <-- token middleware should set this
//     const token = await getValidToken();

//     // ---- Get user details ----
//     const user = await User.findById(userId);
//     if (!user || !user.extensionNumber) {
//       return res.status(400).json({
//         success: false,
//         message: "User extension not found",
//       });
//     }

//     const ext = user.extensionNumber;

//     // // const ext = 1010;
//     // const startTime = moment().subtract(24, "hour").format("MM/DD/YYYY HH:mm:ss");
//     // const endTime = moment().format("MM/DD/YYYY HH:mm:ss");

//     // // Yeastar format: 2025-11-18+10:00:00
//     // const encodedStart = encodeURIComponent(startTime);
//     // const encodedEnd = encodeURIComponent(endTime);

//     // compute start & end in chosen timezone and format in Yeastar style: YYYY-MM-DD+HH:mm:ss
//     // we use moment.tz(...) to ensure the same time window on every server.
//     const endMoment = moment().tz(YEASTAR_TZ);
//     const startMoment = endMoment.clone().subtract(24, "hours");

//     // Yeastar format (example: 2025-11-22+16:38:43)
//     const startTime = startMoment.format("YYYY-MM-DD+HH:mm:ss");
//     const endTime = endMoment.format("YYYY-MM-DD+HH:mm:ss");

//     // url-encode the strings (plus sign becomes %2B which is safe for query param)
//     const encodedStart = encodeURIComponent(startTime);
//     const encodedEnd = encodeURIComponent(endTime);

//     // for debugging - log the timezone & timestamps (remove or reduce in prod)
//     console.log("YEASTAR_TZ:", YEASTAR_TZ);
//     console.log("startTime (formatted):", startTime);
//     console.log("endTime (formatted):", endTime);

//     const urlFrom = `${YEASTAR_BASE_URL}/cdr/search?access_token=${token}&call_from=${ext}&start_time=${encodedStart}&end_time=${encodedEnd}`;
//     const respFrom = await axios.get(urlFrom, {
//       httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
//     });

//     // ----------- API CALL 2 → INBOUND ----------
//     const urlTo = `${YEASTAR_BASE_URL}/cdr/search?access_token=${token}&call_to=${ext}&start_time=${encodedStart}&end_time=${encodedEnd}`;
//     const respTo = await axios.get(urlTo, {
//       httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
//     });

//     console.log("resFrom" + respFrom.data.data);
//     console.log("resTO" + respTo.data.data);



//     const fromList = Array.isArray(respFrom.data?.data) ? respFrom.data.data : [];
//     const toList = Array.isArray(respTo.data?.data) ? respTo.data.data : [];

//     let finalList = [...fromList, ...toList];

//     // ----- Remove duplicates by Yeastar ID -----
//     const map = new Map();
//     finalList.forEach((c) => map.set(c.id, c));
//     finalList = [...map.values()];

//     // ---- SAVE ONLY NEW CDRs ----
//     let inserted = 0;

//     for (const call of finalList) {
//       const exists = await CallHistory.findOne({ yeastarId: call.id });
//       if (exists) continue;
//       console.log(call);

//       await CallHistory.create({
//         userId,
//         extensionNumber: ext,
//         yeastarId: call.id,

//         call_from: call.call_from_number,
//         call_to: call.call_to_number,

//         talk_time: call.talk_duration,
//         ring_time: call.ring_duration,
//         duration: call.duration,

//         direction: call.call_type,          // Outbound / Inbound
//         status: call.disposition,           // ANSWERED / NO ANSWER

//         start_time: new Date(call.time),
//         end_time: new Date(call.time),

//         record_file: call.record_file,
//         disposition_code: call.reason,
//         trunk: call.dst_trunk
//       });


//       inserted++;
//     }

//     return res.json({
//       status: "scuccess",
//       userId,
//       extension: ext,
//       time_window: { startTime, endTime },
//       totalFetched: finalList.length,
//       newInserted: inserted,
//       message: `Stored ${inserted} new call records`,
//     });

//   } catch (err) {
//     console.error("❌ Call History Error:", err.response?.data || err.message);
//     return res.status(500).json({
//       status: "error",
//       message: "Failed to fetch/store call history",
//       error: err.response?.data || err.message,
//     });
//   }
// };


exports.fetchAndStoreCallHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const token = await getValidToken();

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

    const fromList = Array.isArray(respFrom.data?.data) ? respFrom.data.data : [];
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

      await CallHistory.create({
        userId,
        extensionNumber: ext,
        yeastarId: call.id,

        call_from: call.call_from_number,
        call_to: call.call_to_number,

        talk_time: call.talk_duration,
        ring_time: call.ring_duration,
        duration: call.duration,

        direction: call.call_type,
        status: call.disposition,

        start_time: new Date(call.time),
        end_time: new Date(call.time),

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
        message: "Company admin not found"
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
      agentId = ""
    } = req.body;

    // 3️⃣ Decide whose calls to show
    let finalExtension = adminExtension;  // default → show only admin calls
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
        createdByWhichCompanyAdmin: loginUserId
      }).select("firstname lastname extensionNumber");

      if (!agents || agents.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "No valid agents found for provided agentId(s) or they are not under this company admin"
        });
      }

      // prepare extension list and map names
      agentExtensions = agents.map(a => a.extensionNumber);
      agents.forEach(a => {
        agentMap[a.extensionNumber] = `${a.firstname} ${a.lastname}`;
      });
    }


    // 4️⃣ Base query (very important: ONLY ONE extension)
    let query = {
      extensionNumber: agentExtensions
    };

    // 5️⃣ Search filter
    if (search.trim() !== "") {
      query.$or = [
        { call_from: { $regex: search, $options: "i" } },
        { call_to: { $regex: search, $options: "i" } }
      ];
    }

    // 6️⃣ Status array filter
    if (Array.isArray(status) && status.length > 0) {
      const statusMap = {
        answered: "ANSWERED",
        missedCall: "NO ANSWER",
        noAnswered: "NO ANSWER",
        cancelled: "BUSY",
        invalid: "FAILED"
      };

      const mapped = status.map(s => statusMap[s]).filter(Boolean);

      if (mapped.length > 0) {
        query.status = { $in: mapped };
      }
    }

    // 7️⃣ Call types array (Inbound/Outbound/Internal)
    if (Array.isArray(callType) && callType.length > 0) {
      const typeMap = {
        inbound: "Inbound",
        outbound: "Outbound",
        internal: "Internal"
      };

      const mapped = callType.map(t => typeMap[t]).filter(Boolean);

      if (mapped.length > 0) {
        query.direction = { $in: mapped };
      }
    }

    // 8️⃣ Date Filter
    if (startDate && endDate) {
      query.start_time = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
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
    const summaryFilter = { extensionNumber: finalExtension };

    // if (query.direction) summaryFilter.direction = query.direction;
    // if (query.status) summaryFilter.status = query.status;
    // if (query.start_time) summaryFilter.start_time = query.start_time;

    const inbound = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Inbound"
    });

    const outbound = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Outbound"
    });

    const internal = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Internal"
    });

    const missed = await CallHistory.countDocuments({
      ...summaryFilter,
      status: "NO ANSWER"
    });

    const total = inbound + outbound + internal;

    // 1️⃣1️⃣ Add agentName to each record
    const finalData = callRecords.map(c => ({
      ...c._doc,
      agentName
    }));

    return res.json({
      status: "success",
      summary: {
        inboundCalls: inbound,
        internal,
        outboundCalls: outbound,
        missedCalls: missed,
        totalCalls: total
      },
      page: Number(page),
      page_size: Number(page_size),
      totalRecords,
      callRecords: finalData
    });

  } catch (err) {
    console.error("❌ CompanyAdmin Get Call History Error:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve call history",
      error: err.message
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
        message: "agent admin not found"
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
    let finalExtension = agentExtension;  // default → show only admin calls
    let agentName = `${agent.firstname} ${agent.lastname}`;

    let query = {
      extensionNumber: finalExtension
    };

    // 5️⃣ Search filter
    if (search.trim() !== "") {
      query.$or = [
        { call_from: { $regex: search, $options: "i" } },
        { call_to: { $regex: search, $options: "i" } }
      ];
    }

    // 6️⃣ Status array filter
    if (Array.isArray(status) && status.length > 0) {
      const statusMap = {
        answered: "ANSWERED",
        missedCall: "NO ANSWER",
        noAnswered: "NO ANSWER",
        cancelled: "BUSY",
        invalid: "FAILED"
      };

      const mapped = status.map(s => statusMap[s]).filter(Boolean);

      if (mapped.length > 0) {
        query.status = { $in: mapped };
      }
    }

    // 7️⃣ Call types array (Inbound/Outbound/Internal)
    if (Array.isArray(callType) && callType.length > 0) {
      const typeMap = {
        inbound: "Inbound",
        outbound: "Outbound",
        internal: "Internal"
      };

      const mapped = callType.map(t => typeMap[t]).filter(Boolean);

      if (mapped.length > 0) {
        query.direction = { $in: mapped };
      }
    }

    // 8️⃣ Date Filter
    if (startDate && endDate) {
      query.start_time = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
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
    const summaryFilter = { extensionNumber: finalExtension };

    // if (query.direction) summaryFilter.direction = query.direction;
    // if (query.status) summaryFilter.status = query.status;
    // if (query.start_time) summaryFilter.start_time = query.start_time;

    const inbound = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Inbound"
    });

    const outbound = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Outbound"
    });

    const internal = await CallHistory.countDocuments({
      ...summaryFilter,
      direction: "Internal"
    });

    const missed = await CallHistory.countDocuments({
      ...summaryFilter,
      status: "NO ANSWER"
    });

    const total = inbound + outbound + internal;

    // 1️⃣1️⃣ Add agentName to each record
    const finalData = callRecords.map(c => ({
      ...c._doc,
      agentName
    }));

    return res.json({
      status: "success",
      summary: {
        inboundCalls: inbound,
        internal,
        outboundCalls: outbound,
        missedCalls: missed,
        totalCalls: total
      },
      page: Number(page),
      page_size: Number(page_size),
      totalRecords,
      callRecords: finalData
    });

  } catch (err) {
    console.error("❌ CompanyAdmin Get Call History Error:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve call history",
      error: err.message
    });
  }
};

exports.getPhoneNumberCallHistory = async (req, res) => {
  try {
    const loginUserId = req.user._id;

    // 1️⃣ Get logged-in user
    const admin = await User.findById(loginUserId).select(
      "_id firstname lastname extensionNumber role"
    );

    if (!admin) {
      return res.status(400).json({
        status: "error",
        message: "Company admin not found"
      });
    }

    const adminExtension = admin.extensionNumber;

    // 2️⃣ Request body filters
    const {
      page = 1,
      page_size = 20,
      search = "",
      status = [],
      callType = [],
      startDate = "",
      endDate = "",
      phonenumbers = []
    } = req.body;

    // 3️⃣ Handle missing phone numbers
    if (!Array.isArray(phonenumbers) || phonenumbers.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Phone numbers list is required"
      });
    }

    // 4️⃣ Build complete phone variations list
    const flatNumbers = [];

    phonenumbers.forEach(p => {
      const raw = p.number?.trim() || "";
      const cc = p.countryCode?.trim() || "";

      if (!raw) return;

      const variation1 = `${cc}${raw}`;
      const variation2 = raw;
      const variation3 = raw.startsWith("0") ? raw : "0" + raw;
      const variation4 = `${cc}${variation3}`;

      [variation1, variation2, variation3, variation4].forEach(num => {
        if (num && !flatNumbers.includes(num)) {
          flatNumbers.push(num);
        }
      });
    });

    // 5️⃣ Base query: extension <-> phone
    let query = {
      $or: [
        { call_from: { $in: flatNumbers }, call_to: adminExtension },
        { call_from: adminExtension, call_to: { $in: flatNumbers } }
      ]
    };

    // 6️⃣ Search filter
    if (search.trim() !== "") {
      query.$and = [
        {
          $or: [
            { call_from: { $regex: search, $options: "i" } },
            { call_to: { $regex: search, $options: "i" } }
          ]
        }
      ];
    }

    // 7️⃣ Status filter
    if (Array.isArray(status) && status.length > 0) {
      const statusMap = {
        answered: "ANSWERED",
        missedCall: "NO ANSWER",
        noAnswered: "NO ANSWER",
        cancelled: "BUSY",
        invalid: "FAILED"
      };

      const mapped = status.map(s => statusMap[s]).filter(Boolean);

      if (mapped.length > 0) {
        query.status = { $in: mapped };
      }
    }

    // 8️⃣ Call type filter
    if (Array.isArray(callType) && callType.length > 0) {
      const typeMap = {
        inbound: "Inbound",
        outbound: "Outbound",
        internal: "Internal"
      };

      const mapped = callType.map(t => typeMap[t]).filter(Boolean);

      if (mapped.length > 0) {
        query.direction = { $in: mapped };
      }
    }

    // 9️⃣ Date filter
    if (startDate && endDate) {
      query.start_time = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // 🔟 Pagination
    const skip = (page - 1) * page_size;

    const totalRecords = await CallHistory.countDocuments(query);

    const callRecords = await CallHistory.find(query)
      .sort({ start_time: -1 })
      .skip(skip)
      .limit(page_size);

    // 1️⃣1️⃣ Static Summary (Never changes)
    const summary = {
      inboundCalls: 5,
      internal: 4,
      outboundCalls: 119,
      missedCalls: 74,
      totalCalls: 128
    };

    return res.json({
      status: "success",
      summary,
      page,
      page_size,
      totalRecords,
      callRecords
    });

  } catch (err) {
    console.error("❌ PhoneNumber Call History Error:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve phone number call history",
      error: err.message
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
    const url1 = `${YEASTAR_BASE_URL}/recording/download?access_token=${token}&file=${encodeURIComponent(record_file)}`;

    const step1 = await axios.get(url1);
    console.log(step1);

    if (!step1.data.download_resource_url) {
      return res.status(500).json({
        status: "error",
        message: "Yeastar did not return download_resource_url",
        yeastarResponse: step1.data
      });
    }

    const downloadPath = step1.data.download_resource_url;
    const url2 = `https://cmedia.ras.yeastar.com${downloadPath}?access_token=${token}`;

    return res.json({
      status: "success",
      fileName: record_file,
      mimeType: "audio/wav",
      fileUrl: url2
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

/* The above code is a JavaScript function that retrieves the monthly call graph data based on the call
history. Here is a breakdown of what the code does: */
/* The above code is a JavaScript function that generates a monthly call graph based on call history
data. Here is a breakdown of what the code does: */

// exports.getCallHistoryGraph = async (req, res) => {
//   try {
//     const now = new Date();
//     const year = now.getFullYear();
//     const monthIndex = now.getMonth() + 1;

//     const monthStr = `${year}-${String(monthIndex).padStart(2, "0")}`;

//     const startDate = new Date(Date.UTC(year, monthIndex - 1, 1, 0, 0, 0));
//     const endDate = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));

//     const calls = await CallHistory.find({
//       start_time: { $gte: startDate, $lt: endDate }
//     }).select("start_time direction");

//     const totalDays = new Date(year, monthIndex, 0).getDate();
//     const daysArray = [];

//     // 1️⃣ UPDATED STRUCTURE HERE
//     for (let day = 1; day <= totalDays; day++) {
//       daysArray.push({
//         date: `${year}-${String(monthIndex).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
//         inbound: 0,
//         outbound: 0,
//       });
//     }

//     // 2️⃣ UPDATED COUNTER HERE
//     calls.forEach(call => {
//       const d = new Date(call.start_time);
//       const day = d.getUTCDate();

//       if (call.direction === "Inbound") {
//         daysArray[day - 1].inbound++;
//       } else if (call.direction === "Outbound") {
//         daysArray[day - 1].outbound++;
//       }
//     });

//     return res.json({
//       status: "success",
//       month: monthStr,
//       days: daysArray
//     });

//   } catch (error) {
//     console.error("Error:", error);
//     return res.status(500).json({
//       status: "error",
//       message: "Internal server error",
//       error: error.message
//     });
//   }
// };

exports.getInboundOutBoundCallGraph = async (req, res) => {
  try {
    const loginUserId = req.user._id;

    // Fetch logged in user (could be admin or agent/user)
    const loggedUser = await User.findById(loginUserId).select("role createdByWhichCompanyAdmin");

    if (!loggedUser) {
      return res.status(400).json({
        status: "error",
        message: "User not found"
      });
    }

    let userIdsToInclude = [];

    // 🟦 CASE 1: companyAdmin → include ALL users created by this admin + admin itself
    if (loggedUser.role === "companyAdmin") {
      const allUsers = await User.find({
        $or: [
          { createdByWhichCompanyAdmin: loginUserId },
          { _id: loginUserId } // include admin calls also
        ]
      }).select("_id");

      userIdsToInclude = allUsers.map(u => u._id);

    } else {
      // 🟩 CASE 2: agent/user → only own calls
      userIdsToInclude = [loginUserId];
    }

    // ------------------------------
    // DATE RANGE: TODAY → LAST 30 DAYS
    // ------------------------------

    const today = new Date();

    const endDate = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() + 1,   // next day at 00:00
      0, 0, 0
    ));

    const startDate = new Date(Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate() - 29,
      0, 0, 0
    ));

    // ------------------------------
    // FETCH CALLS
    // ------------------------------
    const calls = await CallHistory.find({
      userId: { $in: userIdsToInclude },   // <-- filter by userIds
      start_time: { $gte: startDate, $lt: endDate }
    }).select("start_time direction");

    // ------------------------------
    // FORMAT DATE: 24 Nov 2025
    // ------------------------------
    const formatDate = (dateObj) => {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

      return `${String(dateObj.getUTCDate()).padStart(2, "0")} ${months[dateObj.getUTCMonth()]
        } ${dateObj.getUTCFullYear()}`;
    };

    // ------------------------------
    // BUILD EMPTY LAST-30-DAYS ARRAY
    // ------------------------------
    const daysArray = [];

    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - i
      ));

      daysArray.push({
        date: formatDate(d),
        inbound: 0,
        outbound: 0
      });
    }

    // ------------------------------
    // COUNT CALLS DAY-WISE
    // ------------------------------
    calls.forEach(call => {
      const d = new Date(call.start_time);

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
        end: formatDate(today)
      },
      days: daysArray.reverse() // earliest → latest
    });

  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message
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
    const calls = await CallHistory.find({
      userId: { $in: userIdsToSearch },
      start_time: { $gte: startDate, $lte: endDate },
    }).select("start_time direction status");

    // // 5️⃣ Build days array
    // const daysArray = [];

    // const cursor = moment(startDate);
    // const lastDay = moment(endDate);

    // while (cursor.isSameOrBefore(lastDay, "day")) {
    //   daysArray.push({
    //     date: cursor.format("DD MMM YYYY"), // 👉 21 Oct 2025
    //     inbound: 0,
    //     outbound: 0,
    //   });

    //   cursor.add(1, "day");
    // }

    // // 6️⃣ Count daily values
    // calls.forEach((call) => {
    //   const d = moment(call.start_time).format("DD MMM YYYY");

    //   const dayIndex = daysArray.findIndex((x) => x.date === d);
    //   if (dayIndex !== -1) {
    //     if (call.direction === "Inbound") daysArray[dayIndex].inbound++;
    //     if (call.direction === "Outbound") daysArray[dayIndex].outbound++;
    //   }
    // });

    // 7️⃣ Summary counts
    const inboundTotal = calls.filter((c) => c.direction === "Inbound").length;
    const outboundTotal = calls.filter((c) => c.direction === "Outbound").length;
    const missedTotal = calls.filter(
      (c) => c.status === "NO ANSWER" || c.status === "FAILED" || c.status === "BUSY"
    ).length;

    const totalCalls = inboundTotal + outboundTotal;

    return res.json({
      status: "success",
      startDate: moment(startDate).format("DD MMM YYYY"),
      endDate: moment(endDate).format("DD MMM YYYY"),

      summary: {
        inboundTotal,
        outboundTotal,
        missedTotal,
        totalCalls,
      },

      role: loginUser.role,
      // days: daysArray,
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