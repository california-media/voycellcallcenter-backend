const axios = require("axios");
const YeastarToken = require("../models/YeastarToken");
const YeastarSDKToken = require("../models/YeastarSDKToken");
const User = require("../models/userModel");
const mongoose = require("mongoose");

exports.getDeviceToken = async (deviceId, type = "pbx") => {
    try {
        // 1️⃣ Select token model
        const TokenModel =
            type === "sdk" ? YeastarSDKToken : YeastarToken;

        // 2️⃣ Check existing token in DB first
        let tokenDoc = await TokenModel.findOne({ deviceId });

        // ✅ If access token valid → return
        const buffer = 60 * 1000; // 1 min safety

        if (
            tokenDoc &&
            tokenDoc.expires_at.getTime() - buffer > Date.now()
        ) {
            return tokenDoc.access_token;
        }

        // =====================================================
        // 3️⃣ If expired → Try refresh token
        // =====================================================
        if (tokenDoc?.refresh_token) {
            console.log("hello");
            try {

                // 🔍 Always fetch device again for base_url
                const superAdmins = await User.find({
                    role: "superadmin",
                });

                if (!superAdmins.length)
                    throw new Error("No SuperAdmins found");

                const deviceIdStr = deviceId.toString();
                let device = null;

                for (const admin of superAdmins) {
                    const found = (admin.PBXDevices || []).find(
                        (d) => d.deviceId.toString() === deviceIdStr
                    );

                    if (found) {
                        device = found;
                        break;
                    }
                }

                if (!device)
                    throw new Error("Device credentials not found");

                // 🔑 Use device base URL — NOT tokenDoc
                const refreshUrl = `${device.PBX_BASE_URL}/refresh_token`;

                console.log("🔄 Refresh URL:", refreshUrl);

                const refreshRes = await axios.post(
                    refreshUrl,
                    {
                        refresh_token: tokenDoc.refresh_token,
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                        },
                    }
                );

                if (refreshRes.data?.access_token) {
                    const expiresAt = new Date(
                        Date.now() +
                        (refreshRes.data.expires_in || 7200) * 1000
                    );

                    await TokenModel.findOneAndUpdate(
                        { deviceId },
                        {
                            base_url: device.PBX_BASE_URL,
                            access_token: refreshRes.data.access_token,
                            refresh_token:
                                refreshRes.data.refresh_token ||
                                tokenDoc.refresh_token,
                            expires_in:
                                refreshRes.data.expires_in || 7200,
                            expires_at: expiresAt,
                        },
                        { upsert: true }
                    );

                    return refreshRes.data.access_token;
                }
            } catch (refreshErr) {
                console.log(
                    "⚠️ Refresh token failed, generating new..."
                );
            }
        }

        // =====================================================
        // 4️⃣ Need PBX credentials → Find device in ALL superadmins
        // =====================================================
        // const superAdmins = await User.find({
        //   role: "superadmin",
        //   "PBXDevices.deviceId": deviceId,
        // });

        // if (!superAdmins.length)
        //   throw new Error("Device not found in any SuperAdmin");

        // let device = null;

        // for (const admin of superAdmins) {
        //   const found = admin.PBXDevices.find(
        //     (d) =>
        //       d.deviceId.toString() === deviceId.toString()
        //   );
        //   if (found) {
        //     device = found;
        //     break;
        //   }
        // }

        // if (!device)
        //   throw new Error("Device credentials not found");
        const superAdmins = await User.find({
            role: "superadmin",
        });

        if (!superAdmins.length)
            throw new Error("No SuperAdmins found");

        // Convert deviceId to string once
        const deviceIdStr = deviceId.toString();

        let device = null;

        for (const admin of superAdmins) {
            const found = (admin.PBXDevices || []).find(
                (d) => d.deviceId.toString() === deviceIdStr
            );

            if (found) {
                device = found;
                break;
            }
        }

        if (!device)
            throw new Error("Device credentials not found");


        // =====================================================
        // 5️⃣ Prepare login payload
        // =====================================================
        let loginPayload;

        if (type === "sdk") {
            loginPayload = {
                username: device.PBX_SDK_ACCESS_ID,
                password: device.PBX_SDK_ACCESS_KEY,
            };
        } else {
            loginPayload = {
                username: device.PBX_USERNAME,
                password: device.PBX_PASSWORD,
            };
        }

        // =====================================================
        // 6️⃣ Generate NEW token
        // =====================================================
        const res = await axios.post(
            `${device.PBX_BASE_URL}/get_token`,
            loginPayload,
            {
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent":
                        device.PBX_USER_AGENT || "Voycell-App",
                },
                timeout: 10000,
            }
        );

        if (!res.data?.access_token) {
            throw new Error(
                `${type.toUpperCase()} token generation failed`
            );
        }

        const data = res.data;

        const expiresAt = new Date(
            Date.now() + (data.expires_in || 7200) * 1000
        );

        // 7️⃣ Delete old token
        // await TokenModel.deleteMany({ deviceId });

        // // 8️⃣ Store new token
        // await TokenModel.create({
        //     deviceId,
        //     base_url: device.PBX_BASE_URL, // needed for refresh
        //     access_token: data.access_token,
        //     refresh_token: data.refresh_token,
        //     expires_in: data.expires_in || 7200,
        //     expires_at: expiresAt,
        // });

        await TokenModel.findOneAndUpdate(
            { deviceId },
            {
                deviceId,
                // base_url: device.PBX_BASE_URL,
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_in: data.expires_in || 7200,
                expires_at: expiresAt,
            },
            { upsert: true, new: true }
        );

        return data.access_token;
    } catch (err) {
        console.error(
            `❌ ${type.toUpperCase()} Token Error:`,
            err?.response?.data || err.message
        );
        throw err;
    }
};