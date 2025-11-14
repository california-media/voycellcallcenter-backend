// const axios = require("axios");
// const moment = require("moment");
// const { getValidToken } = require("../utils/yeastarClient");

// const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL;

// exports.getExtensionCallHistory = async (req, res) => {
//     try {
//         const { extension } = req.params;
//         const { pageSize = 500, recordingPageSize = 1000 } = req.query;

//         if (!extension) {
//             return res.status(400).json({ success: false, error: "Extension number is required" });
//         }

//         const token = await getValidToken();
//         const start_time = "2025-11-11 00:00:00"; // fetch all history
//         const end_time = moment().format("YYYY-MM-DD HH:mm:ss");

//         // Fetch all CDRs
//         let allCdrs = [];
//         let currentPage = 1;
//         while (true) {
//             const cdrRes = await axios.get(`${YEASTAR_BASE_URL}/cdr/list?access_token=${token}`, {
//                 params: { start_time, end_time, page: currentPage, page_size: pageSize },
//             });

//             if (cdrRes.data.errcode !== 0) {
//                 console.error("❌ Yeastar CDR error:", cdrRes.data);
//                 return res.status(500).json({
//                     success: false,
//                     error: cdrRes.data.errmsg || "Failed to fetch call history",
//                 });
//             }

//             const cdrList = cdrRes.data.data || [];
//             if (!cdrList.length) break;

//             allCdrs.push(...cdrList); // flatten

//             if (cdrList.length < pageSize) break;
//             currentPage++;
//         }


//         // 🔹 Fetch all recordings (paginated)
//         let recordings = [];
//         let recPage = 1;
//         while (true) {
//             const recRes = await axios.get(`${YEASTAR_BASE_URL}/recording/list?access_token=${token}`, {
//                 params: { page: recPage, page_size: recordingPageSize },
//             });

//             const recList = recRes.data.data || [];
//             // console.log(recRes.data);

//             if (!recList.length) break;

//             recordings.push(...recList);

//             if (recList.length < recordingPageSize) break;
//             recPage++;
//         }

//         // 🔹 Filter and normalize call records
//         const callRecords = allCdrs
//             .filter((rec) => {
//                 const from = String(rec.call_from_number || rec.call_from || rec.caller || rec.src || "");
//                 const to = String(rec.call_to_number || rec.call_to || rec.callee || rec.dst || "");
//                 return from === String(extension) || to === String(extension);
//             })
//             .map((rec) => {
//                 const from = String(rec.call_from_number || rec.call_from || rec.caller || rec.src || "");
//                 const to = String(rec.call_to_number || rec.call_to || rec.callee || rec.dst || "");
//                 const duration = Number(rec.talking_time || rec.duration || rec.time_length || 0);
//                 const call_id = rec.call_id || rec.uid || rec.id || null;

//                 // Parse start_time safely
//                 const startTimeRaw = rec.start_time || rec.time || rec.timestamp;
//                 const start_time = startTimeRaw
//                     ? moment(new Date(startTimeRaw)).format("YYYY-MM-DD HH:mm:ss")
//                     : null;

//                 // Direction logic
//                 let direction = "internal";
//                 if (from === extension && !to.startsWith("1")) direction = "outbound";
//                 else if (to === extension && !from.startsWith("1")) direction = "inbound";

//                 // Status logic
//                 const hangup = (rec.hangup_cause || rec.end_reason || "").toLowerCase();
//                 let status = "Answered";
//                 if (duration === 0 || hangup.includes("no answer") || hangup.includes("missed")) status = "Missed";
//                 else if (hangup.includes("busy")) status = "Busy";

//                 // Find matching recording
//                 const match = recordings.find((r) => {
//                     const rf = String(r.call_from_number || r.caller || r.src || "");
//                     const rt = String(r.call_to_number || r.callee || r.dst || "");
//                     return rf === from && rt === to;
//                 });

//                 return {
//                     call_id,
//                     from,
//                     to,
//                     direction,
//                     status,
//                     duration,
//                     start_time,
//                     recordingFile: match ? match.file : null,
//                     recordingUrl: match
//                         ? `${YEASTAR_BASE_URL}/recording/download?access_token=${token}&file=${encodeURIComponent(match.file)}`
//                         : null,
//                 };
//             });

//         return res.status(200).json({
//             success: true,
//             extension,
//             total: callRecords.length,
//             data: callRecords,
//         });
//     } catch (error) {
//         console.error("❌ getExtensionCallHistory error:", error.response?.data || error.message);
//         return res.status(500).json({
//             success: false,
//             error: error.response?.data?.errmsg || error.message,
//         });
//     }
// };

// const axios = require("axios");
// const moment = require("moment");
// const { getValidToken } = require("../utils/yeastarClient"); // your token refresh logic

// const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL || "https://cmedia.ras.yeastar.com/openapi/v1.0";

// exports.getExtensionCallHistory = async (req, res) => {
//     try {
//         // 🧾 Accept params like PHP did
//         const { ext, sdate, edate, status } = req.body;

//         const token = await getValidToken();
//         let apiUrl = "";
//         let params = {};

//         // ✅ 1. If no filters -> /cdr/list
//         if (!ext && !sdate && !edate && !status) {
//             apiUrl = `${YEASTAR_BASE_URL}/cdr/list`;
//             params = {
//                 access_token: token,
//                 sort_by: "id",
//                 order_by: "desc",
//             };
//         } else {
//             // ✅ 2. If filters exist -> /cdr/search
//             apiUrl = `${YEASTAR_BASE_URL}/cdr/search`;
//             params = { access_token: token };

//             if (ext) {
//                 params.call_from = ext;
//                 params.call_to = ext;

//             }


//             if (sdate && edate) {
//                 const startTime = moment(`${sdate} 00:00:00`, ["YYYY-MM-DD HH:mm:ss", "DD-MM-YYYY HH:mm:ss"]).format("MM/DD/YYYY HH:mm:ss");
//                 const endTime = moment(`${edate} 23:59:59`, ["YYYY-MM-DD HH:mm:ss", "DD-MM-YYYY HH:mm:ss"]).format("MM/DD/YYYY HH:mm:ss");

//                 params.start_time = startTime;
//                 params.end_time = endTime;
//             }

//             if (status) {
//                 params.status = status;
//             }
//         }

//         // ✅ 3. Make API request to Yeastar
//         const { data: cdrRes } = await axios.get(apiUrl, { params });

//         if (cdrRes.errcode && cdrRes.errcode !== 0) {
//             return res.status(400).json({
//                 success: false,
//                 error: cdrRes.errmsg || "Yeastar returned an error",
//             });
//         }

//         const callData = cdrRes.data || [];
//         const totalCalls = cdrRes.total_number || callData.length;

//         return res.status(200).json({
//             success: true,
//             total: totalCalls,
//             data: callData,
//             fetched_from: apiUrl.includes("/search") ? "search" : "list",
//             filters_used: {
//                 extension: ext || null,
//                 sdate: sdate || null,
//                 edate: edate || null,
//                 status: status || null,
//             },
//         });
//     } catch (error) {
//         console.error("❌ Yeastar Call Log Error:", error.response?.data || error.message);
//         return res.status(500).json({
//             success: false,
//             error: error.response?.data?.errmsg || error.message,
//         });
//     }
// };

const axios = require("axios");
const moment = require("moment");
const { getValidToken } = require("../utils/yeastarClient");

const YEASTAR_BASE_URL =
  process.env.YEASTAR_BASE_URL ||
  "https://cmedia.ras.yeastar.com/openapi/v1.0";

exports.getExtensionCallHistory = async (req, res) => {
  try {
    const { ext, sdate, edate } = req.body;

    if (!ext || !sdate || !edate) {
      return res.status(400).json({
        success: false,
        message: "Extension (ext), sdate, and edate are required fields",
      });
    }

    const token = await getValidToken();

    // ✅ Always use /cdr/search for filtered results
    const apiUrl = `${YEASTAR_BASE_URL}/cdr/search`;

    // ✅ Format the date range
    const startTime = moment(sdate, [
      "YYYY-MM-DD HH:mm:ss",
      "DD-MM-YYYY HH:mm:ss",
    ]).format("MM/DD/YYYY HH:mm:ss");

    const endTime = moment(edate, [
      "YYYY-MM-DD HH:mm:ss",
      "DD-MM-YYYY HH:mm:ss",
    ]).format("MM/DD/YYYY HH:mm:ss");

    // ✅ Params to fetch all calls where this ext is either caller or callee
    const params = {
      access_token: token,
      start_time: startTime,
      end_time: endTime,
      // Yeastar requires one filter at a time, so we’ll fetch both directions
      // (1) Calls made by the extension (outbound)
      // (2) Calls received by the extension (inbound)
    };

    // ✅ First fetch calls where the extension is caller
    const outboundRes = await axios.get(apiUrl, {
      params: { ...params, call_from: ext },
    });

    // ✅ Then fetch calls where the extension is receiver
    const inboundRes = await axios.get(apiUrl, {
      params: { ...params, call_to: ext },
    });

    // ✅ Combine and deduplicate call records
    const outboundCalls = outboundRes.data?.data || [];
    const inboundCalls = inboundRes.data?.data || [];
    const allCalls = [...outboundCalls, ...inboundCalls];

    // Optional: remove duplicates by UID (unique call id)
    const uniqueCalls = Array.from(
      new Map(allCalls.map((call) => [call.uid, call])).values()
    );

    return res.status(200).json({
      success: true,
      total: uniqueCalls.length,
      data: uniqueCalls.sort((a, b) => b.id - a.id), // newest first
      filters_used: {
        extension: ext,
        sdate,
        edate,
      },
    });
  } catch (error) {
    console.error("❌ Yeastar Call Log Error:", error.response?.data || error);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.errmsg || error.message,
    });
  }
};
