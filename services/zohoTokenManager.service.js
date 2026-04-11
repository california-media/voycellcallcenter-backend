// const axios = require("axios");
// const User = require("../models/userModel");
// // const { getConfig } = require("../utils/getConfig");

// exports.getZohoAccessToken = async (user) => {
//     return user.zoho.accessToken;
// };

// exports.refreshZohoToken = async (user) => {
//     // const {ZOHO_CLIENT_ID} = getConfig()
//     const url = `${user.zoho.accountsUrl}/oauth/v2/token`;

//     const params = {
//         refresh_token: user.zoho.refreshToken,
//         client_id: process.env.ZOHO_CLIENT_ID,
//         // client_id: ZOHO_CLIENT_ID,
//         client_secret: process.env.ZOHO_CLIENT_SECRET,
//         grant_type: "refresh_token",
//     };

//     const { data } = await axios.post(url, null, { params });

//     if (!data.access_token) {
//         throw new Error("Failed to refresh Zoho token");
//     }

//     user.zoho.accessToken = data.access_token;
//     await user.save();

//     return data.access_token;
// };

const axios = require("axios");
const User = require("../models/userModel");
// const { getConfig } = require("../utils/getConfig");

exports.getZohoAccessToken = async (user) => {
    console.log("[Zoho] Fetching access token for user:", user._id);

    const token = user.zoho.accessToken;

    if (!token) {
        console.warn("[Zoho] No access token found for user:", user._id);
    } else {
        console.log("[Zoho] Access token retrieved successfully");
    }

    return token;
};

exports.refreshZohoToken = async (user) => {
    console.log("[Zoho] Refreshing token for user:", user._id);

    const url = `${user.zoho.accountsUrl}/oauth/v2/token`;
    console.log("[Zoho] Token URL:", url);

    const params = {
        refresh_token: user.zoho.refreshToken,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: "refresh_token",
    };

    try {
        console.log("[Zoho] Sending request to refresh token...");

        const { data } = await axios.post(url, null, { params });

        console.log("[Zoho] Response received from Zoho:", {
            hasAccessToken: !!data.access_token,
            expiresIn: data.expires_in,
        });

        if (!data.access_token) {
            console.error("[Zoho] Failed to refresh token - no access_token in response");
            throw new Error("Failed to refresh Zoho token");
        }

        user.zoho.accessToken = data.access_token;

        console.log("[Zoho] Saving new access token to DB...");
        await user.save();

        console.log("[Zoho] Token refreshed and saved successfully");

        return data.access_token;
    } catch (error) {
        console.error("[Zoho] Error refreshing token:", {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
        });

        throw error;
    }
};