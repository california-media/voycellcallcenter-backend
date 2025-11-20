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

exports.getCompanyCallHistory = async (req, res) => {
    try {
        const loginUserId = req.user._id;

        // 1️⃣ Find all company-admin users including admin
        const allUsers = await User.find({
            $or: [
                { _id: loginUserId }
                // { createdByWhichCompanyAdmin: loginUserId }
            ]
        }).select("_id firstname lastname extensionNumber");

        const userIds = allUsers.map(u => u._id);
        const extNumbers = allUsers.map(u => u.extensionNumber).filter(Boolean);

        // 2️⃣ Receive filters
        const {
            page = 1,
            page_size = 20,
            search = "",
            status = "",
            direction = "",
            startDate = "",
            endDate = "",
            agentId = ""               // ⭐ NEW
        } = req.body;

        // 3️⃣ Base query → all company users
        let query = { extensionNumber: { $in: extNumbers } };

        // ⭐ If specific AGENT ID is selected → filter by its extension
        if (agentId) {
            const agent = await User.findOne({
                _id: agentId,
                $or: [
                    { _id: loginUserId },
                    { createdByWhichCompanyAdmin: loginUserId }
                ]
            }).select("extensionNumber");

            if (!agent) {
                return res.status(400).json({
                    status: "error",
                    message: "Invalid agentId or agent not under this company admin"
                });
            }

            query.extensionNumber = agent.extensionNumber;
        }

        // 4️⃣ Search filter
        if (search.trim() !== "") {

            const usersMatching = await User.find({
                $or: [
                    { firstname: { $regex: search, $options: "i" } },
                    { lastname: { $regex: search, $options: "i" } },
                    { extensionNumber: { $regex: search, $options: "i" } },
                    { email: { $regex: search, $options: "i" } }
                ],
                _id: { $in: userIds }
            }).select("extensionNumber");

            const matchedExtensions = usersMatching.map(u => u.extensionNumber);

            query.$or = [
                { call_from: { $regex: search, $options: "i" } },
                { call_to: { $regex: search, $options: "i" } },
                { extensionNumber: { $in: matchedExtensions } }
            ];
        }

        // 5️⃣ Status filter
        if (status) {
            if (status === "answered") query.status = "ANSWERED";
            if (status === "missed") query.status = "NO ANSWER";
            if (status === "not_answered") query.status = "NO ANSWER";
            if (status === "disconnected") query.status = "BUSY";
        }

        // 6️⃣ Direction filter
        if (direction) query.direction = direction;

        // 7️⃣ Date filter
        if (startDate && endDate) {
            query.start_time = {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
            };
        }

        // 8️⃣ Pagination
        const skip = (page - 1) * page_size;

        const totalRecords = await CallHistory.countDocuments(query);

        const callRecords = await CallHistory.find(query)
            .sort({ start_time: -1 })
            .skip(skip)
            .limit(page_size);

        // 9️⃣ Summary (use same agent filter)
        const summaryFilter = { extensionNumber: query.extensionNumber };

        const inbound = await CallHistory.countDocuments({
            ...summaryFilter,
            direction: "Inbound",
        });

        const outbound = await CallHistory.countDocuments({
            ...summaryFilter,
            direction: "Outbound",
        });

        const Internal = await CallHistory.countDocuments({
            ...summaryFilter,
            direction: "Internal",
        });

        const missed = await CallHistory.countDocuments({
            ...summaryFilter,
            status: "NO ANSWER",
        });

        const total = inbound + outbound + Internal;

        // 🔟 Attach agent name
        const userMap = {};
        allUsers.forEach(u => {
            userMap[u.extensionNumber] = `${u.firstname || ""} ${u.lastname || ""}`;
        });

        const finalData = callRecords.map(c => ({
            ...c._doc,
            agentName: userMap[c.extensionNumber] || "Unknown",
        }));

        return res.json({
            status: "success",
            summary: {
                inboundCalls: inbound,
                internal: Internal,
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