const axios = require("axios");
const User = require("../models/userModel");

exports.getZohoAccessToken = async (user) => {
    return user.zoho.accessToken;
};

exports.refreshZohoToken = async (user) => {
    const url = `${user.zoho.accountsUrl}/oauth/v2/token`;

    const params = {
        refresh_token: user.zoho.refreshToken,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: "refresh_token",
    };

    const { data } = await axios.post(url, null, { params });

    if (!data.access_token) {
        throw new Error("Failed to refresh Zoho token");
    }

    user.zoho.accessToken = data.access_token;
    await user.save();

    return data.access_token;
};
