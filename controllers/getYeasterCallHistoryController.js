const axios = require("axios");
const moment = require("moment");
const { getValidToken } = require("../utils/yeastarClient");

const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL;

exports.getExtensionCallHistory = async (req, res) => {
    try {
        const { extension } = req.params;
        const { pageSize = 500, recordingPageSize = 1000 } = req.query;

        if (!extension) {
            return res.status(400).json({ success: false, error: "Extension number is required" });
        }

        const token = await getValidToken();
        const start_time = "2020-01-01 00:00:00"; // fetch all history
        const end_time = moment().format("YYYY-MM-DD HH:mm:ss");

        // Fetch all CDRs
        let allCdrs = [];
        let currentPage = 1;
        while (true) {
            const cdrRes = await axios.get(`${YEASTAR_BASE_URL}/cdr/list?access_token=${token}`, {
                params: { start_time, end_time, page: currentPage, page_size: pageSize },
            });

            if (cdrRes.data.errcode !== 0) {
                console.error("❌ Yeastar CDR error:", cdrRes.data);
                return res.status(500).json({
                    success: false,
                    error: cdrRes.data.errmsg || "Failed to fetch call history",
                });
            }

            const cdrList = cdrRes.data.data || [];
            if (!cdrList.length) break;

            allCdrs.push(...cdrList); // flatten

            if (cdrList.length < pageSize) break;
            currentPage++;
        }


        // 🔹 Fetch all recordings (paginated)
        let recordings = [];
        let recPage = 1;
        while (true) {
            const recRes = await axios.get(`${YEASTAR_BASE_URL}/recording/list?access_token=${token}`, {
                params: { page: recPage, page_size: recordingPageSize },
            });

            const recList = recRes.data.data || [];
            // console.log(recRes.data);
            
            if (!recList.length) break;

            recordings.push(...recList);

            if (recList.length < recordingPageSize) break;
            recPage++;
        }

        // 🔹 Filter and normalize call records
        const callRecords = allCdrs
            .filter((rec) => {
                const from = String(rec.call_from_number || rec.call_from || rec.caller || rec.src || "");
                const to = String(rec.call_to_number || rec.call_to || rec.callee || rec.dst || "");
                return from === String(extension) || to === String(extension);
            })
            .map((rec) => {
                const from = String(rec.call_from_number || rec.call_from || rec.caller || rec.src || "");
                const to = String(rec.call_to_number || rec.call_to || rec.callee || rec.dst || "");
                const duration = Number(rec.talking_time || rec.duration || rec.time_length || 0);
                const call_id = rec.call_id || rec.uid || rec.id || null;

                // Parse start_time safely
                const startTimeRaw = rec.start_time || rec.time || rec.timestamp;
                const start_time = startTimeRaw
                    ? moment(new Date(startTimeRaw)).format("YYYY-MM-DD HH:mm:ss")
                    : null;

                // Direction logic
                let direction = "internal";
                if (from === extension && !to.startsWith("1")) direction = "outbound";
                else if (to === extension && !from.startsWith("1")) direction = "inbound";

                // Status logic
                const hangup = (rec.hangup_cause || rec.end_reason || "").toLowerCase();
                let status = "Answered";
                if (duration === 0 || hangup.includes("no answer") || hangup.includes("missed")) status = "Missed";
                else if (hangup.includes("busy")) status = "Busy";

                // Find matching recording
                const match = recordings.find((r) => {
                    const rf = String(r.call_from_number || r.caller || r.src || "");
                    const rt = String(r.call_to_number || r.callee || r.dst || "");
                    return rf === from && rt === to;
                });

                return {
                    call_id,
                    from,
                    to,
                    direction,
                    status,
                    duration,
                    start_time,
                    recordingFile: match ? match.file : null,
                    recordingUrl: match
                        ? `${YEASTAR_BASE_URL}/recording/download?access_token=${token}&file=${encodeURIComponent(match.file)}`
                        : null,
                };
            });

        return res.status(200).json({
            success: true,
            extension,
            total: callRecords.length,
            data: callRecords,
        });
    } catch (error) {
        console.error("❌ getExtensionCallHistory error:", error.response?.data || error.message);
        return res.status(500).json({
            success: false,
            error: error.response?.data?.errmsg || error.message,
        });
    }
};

