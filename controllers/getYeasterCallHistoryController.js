const axios = require("axios");
const moment = require("moment");
const https = require("https");
const { getValidToken } = require("../utils/yeastarClient");
const User = require("../models/userModel"); // make sure to import
const CallHistory = require("../models/CallHistory");

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

exports.fetchAndStoreCallHistory = async (req, res) => {
  try {
    const userId = req.user._id; // <-- token middleware should set this
    const token = await getValidToken();

    // ---- Get user details ----
    const user = await User.findById(userId);
    if (!user || !user.extensionNumber) {
      return res.status(400).json({
        success: false,
        message: "User extension not found",
      });
    }

    const ext = user.extensionNumber;

    // const ext = 1010;
    const startTime = moment().subtract(24, "hour").format("MM/DD/YYYY HH:mm:ss");
    const endTime = moment().format("MM/DD/YYYY HH:mm:ss");

    // Yeastar format: 2025-11-18+10:00:00
    const encodedStart = encodeURIComponent(startTime);
    const encodedEnd = encodeURIComponent(endTime);

    const urlFrom = `${YEASTAR_BASE_URL}/cdr/search?access_token=${token}&call_from=${ext}&start_time=${encodedStart}&end_time=${encodedEnd}`;
    const respFrom = await axios.get(urlFrom, {
      httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
    });

    // ----------- API CALL 2 → INBOUND ----------
    const urlTo = `${YEASTAR_BASE_URL}/cdr/search?access_token=${token}&call_to=${ext}&start_time=${encodedStart}&end_time=${encodedEnd}`;
    const respTo = await axios.get(urlTo, {
      httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
    });

    console.log("resFrom" + respFrom.data.data);
    console.log("resTO" + respTo.data.data);



    const fromList = Array.isArray(respFrom.data?.data) ? respFrom.data.data : [];
    const toList = Array.isArray(respTo.data?.data) ? respTo.data.data : [];

    let finalList = [...fromList, ...toList];

    // ----- Remove duplicates by Yeastar ID -----
    const map = new Map();
    finalList.forEach((c) => map.set(c.id, c));
    finalList = [...map.values()];

    // ---- SAVE ONLY NEW CDRs ----
    let inserted = 0;

    for (const call of finalList) {
      const exists = await CallHistory.findOne({ yeastarId: call.id });
      if (exists) continue;
      console.log(call);

      await CallHistory.create({
        userId,
        extensionNumber: ext,
        yeastarId: call.id,

        call_from: call.call_from_number,
        call_to: call.call_to_number,

        talk_time: call.talk_duration,
        ring_time: call.ring_duration,
        duration: call.duration,

        direction: call.call_type,          // Outbound / Inbound
        status: call.disposition,           // ANSWERED / NO ANSWER

        start_time: new Date(call.time),
        end_time: new Date(call.time),

        record_file: call.record_file,
        disposition_code: call.reason,
        trunk: call.dst_trunk
      });


      inserted++;
    }

    return res.json({
      status: "scuccess",
      userId,
      extension: ext,
      time_window: { startTime, endTime },
      totalFetched: finalList.length,
      newInserted: inserted,
      message: `Stored ${inserted} new call records`,
    });

  } catch (err) {
    console.error("❌ Call History Error:", err.response?.data || err.message);
    return res.status(500).json({
      status: "error",
      message: "Failed to fetch/store call history",
      error: err.response?.data || err.message,
    });
  }
};

// exports.getCompanyCallHistory = async (req, res) => {
//     try {
//         const loginUserId = req.user._id;

//         // 1️⃣ Find all company-admin users including admin
//         const allUsers = await User.find({
//             $or: [
//                 { _id: loginUserId }
//                 // { createdByWhichCompanyAdmin: loginUserId }
//             ]
//         }).select("_id firstname lastname extensionNumber");

//         const userIds = allUsers.map(u => u._id);
//         const extNumbers = allUsers.map(u => u.extensionNumber).filter(Boolean);

//         // 2️⃣ Receive filters
//         const {
//             page = 1,
//             page_size = 20,
//             search = "",
//             status = "",
//             direction = "",
//             startDate = "",
//             endDate = "",
//             agentId = ""               // ⭐ NEW
//         } = req.body;

//         // 3️⃣ Base query → all company users
//         let query = { extensionNumber: { $in: extNumbers } };

//         // ⭐ If specific AGENT ID is selected → filter by its extension
//         if (agentId) {
//             const agent = await User.findOne({
//                 _id: agentId,
//                 $or: [
//                     { _id: loginUserId },
//                     { createdByWhichCompanyAdmin: loginUserId }
//                 ]
//             }).select("extensionNumber");

//             if (!agent) {
//                 return res.status(400).json({
//                     status: "error",
//                     message: "Invalid agentId or agent not under this company admin"
//                 });
//             }

//             query.extensionNumber = agent.extensionNumber;
//         }

//         // 4️⃣ Search filter
//         if (search.trim() !== "") {

//             const usersMatching = await User.find({
//                 $or: [
//                     { firstname: { $regex: search, $options: "i" } },
//                     { lastname: { $regex: search, $options: "i" } },
//                     { extensionNumber: { $regex: search, $options: "i" } },
//                     { email: { $regex: search, $options: "i" } }
//                 ],
//                 _id: { $in: userIds }
//             }).select("extensionNumber");

//             const matchedExtensions = usersMatching.map(u => u.extensionNumber);

//             query.$or = [
//                 { call_from: { $regex: search, $options: "i" } },
//                 { call_to: { $regex: search, $options: "i" } },
//                 { extensionNumber: { $in: matchedExtensions } }
//             ];
//         }

//         // 5️⃣ Status filter
//         if (status) {
//             if (status === "answered") query.status = "ANSWERED";
//             if (status === "missed") query.status = "NO ANSWER";
//             if (status === "not_answered") query.status = "NO ANSWER";
//             if (status === "disconnected") query.status = "BUSY";
//         }

//         // 6️⃣ Direction filter
//         if (direction) query.direction = direction;

//         // 7️⃣ Date filter
//         if (startDate && endDate) {
//             query.start_time = {
//                 $gte: new Date(startDate),
//                 $lte: new Date(endDate),
//             };
//         }

//         // 8️⃣ Pagination
//         const skip = (page - 1) * page_size;

//         const totalRecords = await CallHistory.countDocuments(query);

//         const callRecords = await CallHistory.find(query)
//             .sort({ start_time: -1 })
//             .skip(skip)
//             .limit(page_size);

//         // 9️⃣ Summary (use same agent filter)
//         const summaryFilter = { extensionNumber: query.extensionNumber };

//         const inbound = await CallHistory.countDocuments({
//             ...summaryFilter,
//             direction: "Inbound",
//         });

//         const outbound = await CallHistory.countDocuments({
//             ...summaryFilter,
//             direction: "Outbound",
//         });

//         const Internal = await CallHistory.countDocuments({
//             ...summaryFilter,
//             direction: "Internal",
//         });

//         const missed = await CallHistory.countDocuments({
//             ...summaryFilter,
//             status: "NO ANSWER",
//         });

//         const total = inbound + outbound + Internal;

//         // 🔟 Attach agent name
//         const userMap = {};
//         allUsers.forEach(u => {
//             userMap[u.extensionNumber] = `${u.firstname || ""} ${u.lastname || ""}`;
//         });

//         const finalData = callRecords.map(c => ({
//             ...c._doc,
//             agentName: userMap[c.extensionNumber] || "Unknown",
//         }));

//         return res.json({
//             status: "success",
//             summary: {
//                 inboundCalls: inbound,
//                 internal: Internal,
//                 outboundCalls: outbound,
//                 missedCalls: missed,
//                 totalCalls: total,
//             },
//             page: Number(page),
//             page_size: Number(page_size),
//             totalRecords,
//             callRecords: finalData,
//         });

//     } catch (err) {
//         console.error("❌ CompanyAdmin Get Call History Error:", err);
//         return res.status(500).json({
//             status: "error",
//             message: "Failed to retrieve call history",
//             error: err.message,
//         });
//     }
// };

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

    if (agentId) {
      // Validate agent belongs to this company admin
      const agent = await User.findOne({
        _id: agentId,
        createdByWhichCompanyAdmin: loginUserId   // ensure it's this admin's agent
      }).select("firstname lastname extensionNumber");

      if (!agent) {
        return res.status(400).json({
          status: "error",
          message: "Invalid agentId or agent not under this company admin"
        });
      }

      finalExtension = agent.extensionNumber;
      agentName = `${agent.firstname} ${agent.lastname}`;
    }

    // 4️⃣ Base query (very important: ONLY ONE extension)
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

    // 1️⃣ Fetch company admin (ONLY login user)
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
      phonenumbers = []
    } = req.body;

    // 3️⃣ Convert phoneNumbers list
    const flatNumbers = phonenumbers.map(p => `${p.countryCode}${p.number}`);

    if (flatNumbers.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Phone numbers list is required"
      });
    }

    // 4️⃣ Base query: calls where user’s extension is involved
    let query = {
      $or: [
        {
          // phone → extension
          call_from: { $in: flatNumbers },
          call_to: adminExtension
        },
        {
          // extension → phone
          call_from: adminExtension,
          call_to: { $in: flatNumbers }
        }
      ]
    };

    // 5️⃣ Search filter
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

    // 6️⃣ Status filter
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

    // 7️⃣ Call type filter (Inbound / Outbound / Internal)
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

    // 8️⃣ Date filter
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

    // 🔟 Summary counts
    const summaryFilter = { ...query };

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

    return res.json({
      status: "success",
      summary: {
        inboundCalls: inbound,
        outboundCalls: outbound,
        internalCalls: internal,
        missedCalls: missed,
        totalCalls: total
      },
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

// exports.getMonthlyCallGraph = async (req, res) => {
//   try {
//     const loginUserId = req.user._id;

//     const now = new Date();
//     const year = now.getUTCFullYear();
//     const month = now.getUTCMonth(); // 0-11

//     const firstDay = new Date(Date.UTC(year, month, 1, 0, 0, 0));
//     const lastDay = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));

//     const agg = await CallHistory.aggregate([
//       {
//         $match: {
//           userId: loginUserId,
//           start_time: { $gte: firstDay, $lte: lastDay }
//         }
//       },
//       {
//         $group: {
//           _id: { $dayOfMonth: "$start_time" },
//           count: { $sum: 1 }
//         }
//       },
//       { $sort: { "_id": 1 } }
//     ]);

//     const daysInMonth = new Date(year, month + 1, 0).getUTCDate();
//     const graph = [];

//     for (let day = 1; day <= daysInMonth; day++) {
//       const found = agg.find((d) => d._id === day);
//       graph.push({
//         date: `${year}-${(month + 1).toString().padStart(2, "0")}-${day
//           .toString()
//           .padStart(2, "0")}`,
//         count: found ? found.count : 0,
//       });
//     }

//     return res.json({
//       status: "success",
//       month: `${year}-${(month + 1).toString().padStart(2, "0")}`,
//       days: graph,
//     });

//   } catch (err) {
//     console.error("Graph API Error:", err);
//     return res.status(500).json({
//       status: "error",
//       message: "Failed to generate call graph",
//       error: err.message
//     });
//   }
// };

exports.getMonthlyCallGraph = async (req, res) => {
  try {
    // AUTO GET CURRENT MONTH
    const now = new Date();
    const year = now.getFullYear();
    const monthIndex = now.getMonth() + 1;

    const monthStr = `${year}-${String(monthIndex).padStart(2, "0")}`;

    // START & END DATES (UTC SAFE)
    const startDate = new Date(Date.UTC(year, monthIndex - 1, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));

    console.log({ startDate, endDate });

    // FIXED FIELD NAME HERE 🔥🔥🔥
    const calls = await CallHistory.find({
      start_time: { $gte: startDate, $lt: endDate }
    }).select("start_time");

    const totalDays = new Date(year, monthIndex, 0).getDate();
    const daysArray = [];

    for (let day = 1; day <= totalDays; day++) {
      daysArray.push({
        date: `${year}-${String(monthIndex).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        count: 0,
      });
    }

    calls.forEach(call => {
      const d = new Date(call.start_time);
      const day = d.getUTCDate();
      daysArray[day - 1].count++;
    });

    return res.json({
      status: "success",
      month: monthStr,
      days: daysArray
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
