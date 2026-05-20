const axios = require("axios");
const https = require("https");
const YeastarToken = require("../models/YeastarToken");
const YeastarSDKToken = require("../models/YeastarSDKToken");
const User = require("../models/userModel");
const mongoose = require("mongoose");

const pbxAgent = new https.Agent({ rejectUnauthorized: false });


/**
 * Detect Yeastar token expiry response
 */
function isTokenExpiredResponse(data) {
    return data?.errcode === 10004;
}

/**
 * Main Token Function
 * Works for PBX + SDK
 */
exports.getDeviceToken = async (deviceId, type = "pbx") => {
    if (!deviceId) throw new Error("getDeviceToken called with null/undefined deviceId");
    try {
        const TokenModel =
            type === "sdk" ? YeastarSDKToken : YeastarToken;

        let tokenDoc = await TokenModel.findOne({ deviceId });

        // ⏱ Expiry buffer (5 minutes safety)
        const buffer = 5 * 60 * 1000;

        /**
         * ─────────────────────────────
         * 1️⃣ Check DB Expiry + Validate
         * ─────────────────────────────
         */
        if (
            tokenDoc &&
            tokenDoc.expires_at &&
            tokenDoc.expires_at.getTime() - buffer > Date.now()
        ) {
            try {
                const test = await axios.get(
                    `${tokenDoc.base_url}/extension/list?access_token=${tokenDoc.access_token}`,
                    { httpsAgent: pbxAgent }
                );

                if (test.data?.errcode === 0) {
                    return tokenDoc.access_token;
                }

                if (isTokenExpiredResponse(test.data)) {
                }

            } catch (err) {
                const code = err?.response?.data?.errcode;

                if (code === 10004) {
                } else {
                }
            }
        }

        /**
         * ─────────────────────────────
         * 2️⃣ Fetch Device Credentials
         * ─────────────────────────────
         */
        const superAdmins = await User.find({
            role: "superadmin",
        });

        let device = null;
        const deviceIdStr = deviceId.toString();

        for (const admin of superAdmins) {
            const found = (admin.PBXDevices || []).find(
                (d) => d.deviceId && d.deviceId.toString() === deviceIdStr
            );
            if (found) {
                device = found;
                break;
            }
        }

        if (!device) {
            throw new Error("Device credentials not found");
        }

        /**
         * ─────────────────────────────
         * 3️⃣ Try Refresh Token
         * ─────────────────────────────
         */
        if (tokenDoc?.refresh_token) {
            try {
                const refreshRes = await axios.post(
                    `${device.PBX_BASE_URL}/refresh_token`,
                    { refresh_token: tokenDoc.refresh_token },
                    { httpsAgent: pbxAgent }
                );

                if (refreshRes.data?.access_token) {
                    return await updateTokenInDb(
                        TokenModel,
                        deviceId,
                        refreshRes.data,
                        device.PBX_BASE_URL
                    );
                }
            } catch (refreshErr) {
            }
        }

        /**
         * ─────────────────────────────
         * 4️⃣ Full Login (New Token)
         * ─────────────────────────────
         */
        const loginPayload =
            type === "sdk"
                ? {
                    username: device.PBX_SDK_ACCESS_ID,
                    password: device.PBX_SDK_ACCESS_KEY,
                }
                : {
                    username: device.PBX_USERNAME,
                    password: device.PBX_PASSWORD,
                };

        const res = await axios.post(
            `${device.PBX_BASE_URL}/get_token`,
            loginPayload,
            {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": device.PBX_USER_AGENT || "Voycell-App",
                },
                httpsAgent: pbxAgent,
            }
        );

        if (!res.data?.access_token) {
            console.error(
                `[getDeviceToken] ${type.toUpperCase()} login failed for device ${deviceIdStr} at ${device.PBX_BASE_URL}`,
                `| PBX response: errcode=${res.data?.errcode} errmsg=${res.data?.errmsg}`,
                `| full body:`, JSON.stringify(res.data)
            );
            throw new Error(
                `${type.toUpperCase()} login failed: errcode=${res.data?.errcode ?? "none"} errmsg=${res.data?.errmsg ?? "no message"}`
            );
        }
        return await updateTokenInDb(
            TokenModel,
            deviceId,
            res.data,
            device.PBX_BASE_URL
        );

    } catch (err) {
        throw err;
    }
};

/**
 * ─────────────────────────────
 * Helper → Store Token in DB
 * ─────────────────────────────
 */
async function updateTokenInDb(
    Model,
    deviceId,
    data,
    baseUrl
) {
    const expiresAt = new Date(
        Date.now() + (data.expires_in || 7200) * 1000
    );

    const updated = await Model.findOneAndUpdate(
        { deviceId },
        {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_in: data.expires_in || 7200,
            expires_at: expiresAt,
            base_url: baseUrl,
        },
        {
            upsert: true,
            new: true,
        }
    );

    return updated.access_token;
}