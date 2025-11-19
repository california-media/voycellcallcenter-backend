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

        // 1️⃣ Find all users created by this company admin + admin itself
        const allUsers = await User.find({
            $or: [
                { _id: loginUserId },
                { createdByWhichCompanyAdmin: loginUserId }
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
        } = req.body;

        const query = { extensionNumber: { $in: extNumbers } };

        // const query = { extensionNumber: 1010 };


        // 3️⃣ Search filter (agent, extension, call_from, call_to)
        if (search.trim() !== "") {

            // --- Search in agent details ---
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

            // --- Apply full search on call history ---
            query.$or = [
                { call_from: { $regex: search, $options: "i" } },
                { call_to: { $regex: search, $options: "i" } },
                { extensionNumber: { $in: matchedExtensions } }  // from User search
            ];
        }

        // 4️⃣ Status filter (Answered / Missed / Not Answered / Disconnected)
        if (status) {
            if (status === "answered") query.status = "ANSWERED";
            if (status === "missed") query.status = "NO ANSWER";
            if (status === "not_answered") query.status = "NO ANSWER";
            if (status === "disconnected") query.status = "BUSY";
        }

        // 5️⃣ Direction filter (Inbound / Outbound)
        if (direction) query.direction = direction;

        // 6️⃣ Date filter
        if (startDate && endDate) {
            query.start_time = {
                $gte: new Date(startDate),
                $lte: new Date(endDate),
            };
        }

        // 7️⃣ Pagination
        const skip = (page - 1) * page_size;

        const totalRecords = await CallHistory.countDocuments(query);

        const callRecords = await CallHistory.find(query)
            .sort({ start_time: -1 })
            .skip(skip)
            .limit(page_size);

        // 8️⃣ Generate Summary
        const inbound = await CallHistory.countDocuments({
            extensionNumber: { $in: extNumbers },
            // extensionNumber: 1010,
            direction: "Inbound",
        });

        const outbound = await CallHistory.countDocuments({
            extensionNumber: { $in: extNumbers },
            // extensionNumber: 1010,
            direction: "Outbound",
        });

        const Internal = await CallHistory.countDocuments({
            extensionNumber: { $in: extNumbers },
            // extensionNumber: 1010,
            direction: "Internal",
        });

        const missed = await CallHistory.countDocuments({
            extensionNumber: { $in: extNumbers },
            // extensionNumber: 1010,
            status: "NO ANSWER",
        });

        const total = inbound + outbound + Internal;

        // 9️⃣ Attach agent name to each call
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