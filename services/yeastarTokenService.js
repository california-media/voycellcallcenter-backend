// const axios = require("axios");
// const YeastarToken = require("../models/YeastarToken");
// const YeastarSDKToken = require("../models/YeastarSDKToken");
// const User = require("../models/userModel");
// const mongoose = require("mongoose");


// exports.getDeviceToken = async (deviceId, type = "pbx") => {
//     try {
//         const TokenModel = type === "sdk" ? YeastarSDKToken : YeastarToken;
//         let tokenDoc = await TokenModel.findOne({ deviceId });

//         // 1. Check validity with a larger buffer (5 minutes)
//         const buffer = 5 * 60 * 1000;
//         // if (
//         //     tokenDoc &&
//         //     tokenDoc.expires_at &&
//         //     tokenDoc.expires_at.getTime() - buffer > Date.now()
//         // ) {
//         //     // 🔍 Validate token with PBX
//         //     try {
//         //         const test = await axios.get(
//         //             `${tokenDoc.base_url}/extension/list?access_token=${tokenDoc.access_token}`
//         //         );

//         //         if (test.data?.errcode === 0) {
//         //             return tokenDoc.access_token; // still valid
//         //         }

//         //         console.log("⚠️ Token expired on PBX, regenerating...");
//         //     } catch (err) {
//         //         console.log("⚠️ Token invalid on PBX, regenerating...");
//         //     }
//         // }

//         if (
//             tokenDoc &&
//             tokenDoc.expires_at &&
//             tokenDoc.expires_at.getTime() - buffer > Date.now()
//         ) {
//             try {
//                 const test = await axios.get(
//                     `${tokenDoc.base_url}/extension/list?access_token=${tokenDoc.access_token}`
//                 );

//                 // ✅ Token still valid
//                 if (test.data?.errcode === 0) {
//                     return tokenDoc.access_token;
//                 }

//                 // ❌ Token expired
//                 if (isTokenExpiredResponse(test.data)) {
//                     console.log("🔑 Token expired (10004) → regenerate");
//                 } else {
//                     console.log("⚠️ Extension API failed → regenerate");
//                 }

//             } catch (err) {
//                 const code = err?.response?.data?.errcode;

//                 if (code === 10004) {
//                     console.log("🔑 Token expired from catch → regenerate");
//                 } else {
//                     console.log("⚠️ Validation request failed → regenerate");
//                 }
//             }
//         }

//         // 2. Fetch Device Credentials (do this once)
//         const superAdmins = await User.find({ role: "superadmin" });
//         let device = null;
//         const deviceIdStr = deviceId.toString();

//         for (const admin of superAdmins) {
//             const found = (admin.PBXDevices || []).find(d => d.deviceId.toString() === deviceIdStr);
//             if (found) { device = found; break; }
//         }
//         if (!device) throw new Error("Device credentials not found");

//         // 3. Try Refresh if available
//         if (tokenDoc?.refresh_token) {
//             try {
//                 const refreshRes = await axios.post(`${device.PBX_BASE_URL}/refresh_token`, {
//                     refresh_token: tokenDoc.refresh_token,
//                 });

//                 if (refreshRes.data?.access_token) {
//                     return await updateTokenInDb(TokenModel, deviceId, refreshRes.data, device.PBX_BASE_URL);
//                 }
//             } catch (refreshErr) {
//                 console.log("🔄 Refresh failed, proceeding to full login...");
//             }
//         }

//         // 4. Full Login (New Token)
//         const loginPayload = type === "sdk"
//             ? { username: device.PBX_SDK_ACCESS_ID, password: device.PBX_SDK_ACCESS_KEY }
//             : { username: device.PBX_USERNAME, password: device.PBX_PASSWORD };

//         const res = await axios.post(`${device.PBX_BASE_URL}/get_token`, loginPayload, {
//             headers: {
//                 "Content-Type": "application/json",
//                 "User-Agent": device.PBX_USER_AGENT || "Voycell-App"
//             }
//         });

//         if (!res.data?.access_token) throw new Error(`${type.toUpperCase()} login failed`);

//         return await updateTokenInDb(TokenModel, deviceId, res.data, device.PBX_BASE_URL);

//     } catch (err) {
//         console.error(`❌ ${type.toUpperCase()} Token Error:`, err.message);
//         throw err;
//     }
// };

// // Helper to keep DB logic clean
// async function updateTokenInDb(Model, deviceId, data, baseUrl) {
//     const expiresAt = new Date(Date.now() + (data.expires_in || 7200) * 1000);
//     const updated = await Model.findOneAndUpdate(
//         { deviceId },
//         {
//             access_token: data.access_token,
//             refresh_token: data.refresh_token,
//             expires_in: data.expires_in || 7200,
//             expires_at: expiresAt,
//             // Store base_url here to ensure consistency
//             base_url: baseUrl
//         },
//         { upsert: true, new: true }
//     );
//     return updated.access_token;
// }


const axios = require("axios");
const YeastarToken = require("../models/YeastarToken");
const YeastarSDKToken = require("../models/YeastarSDKToken");
const User = require("../models/userModel");
const mongoose = require("mongoose");


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
                console.log("🔍 Validating existing token...");

                const test = await axios.get(
                    `${tokenDoc.base_url}/extension/list?access_token=${tokenDoc.access_token}`
                );

                if (test.data?.errcode === 0) {
                    console.log("✅ Token still valid");
                    return tokenDoc.access_token;
                }

                if (isTokenExpiredResponse(test.data)) {
                    console.log("🔑 Token expired (10004)");
                } else {
                    console.log("⚠️ Token invalid, regenerating...");
                }

            } catch (err) {
                const code = err?.response?.data?.errcode;

                if (code === 10004) {
                    console.log("🔑 Token expired from catch");
                } else {
                    console.log("⚠️ Validation API failed");
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
                (d) => d.deviceId.toString() === deviceIdStr
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
                console.log("🔄 Trying refresh token...");

                const refreshRes = await axios.post(
                    `${device.PBX_BASE_URL}/refresh_token`,
                    {
                        refresh_token: tokenDoc.refresh_token,
                    }
                );

                if (refreshRes.data?.access_token) {
                    console.log("✅ Token refreshed");

                    return await updateTokenInDb(
                        TokenModel,
                        deviceId,
                        refreshRes.data,
                        device.PBX_BASE_URL
                    );
                }

                console.log(
                    "⚠️ Refresh response invalid → Full login"
                );

            } catch (refreshErr) {
                console.log(
                    "❌ Refresh failed → Full login"
                );
            }
        }

        /**
         * ─────────────────────────────
         * 4️⃣ Full Login (New Token)
         * ─────────────────────────────
         */
        console.log("🔐 Generating new token via login...");

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
                    "User-Agent":
                        device.PBX_USER_AGENT || "Voycell-App",
                },
            }
        );

        if (!res.data?.access_token) {
            throw new Error(
                `${type.toUpperCase()} login failed`
            );
        }

        console.log("✅ New token generated");

        return await updateTokenInDb(
            TokenModel,
            deviceId,
            res.data,
            device.PBX_BASE_URL
        );

    } catch (err) {
        console.error(
            `❌ ${type.toUpperCase()} Token Error:`,
            err.response?.data || err.message
        );
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