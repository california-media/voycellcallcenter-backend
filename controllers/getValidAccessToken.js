const axios = require("axios");
const moment = require("moment");
const { getValidToken } = require("../utils/yeastarClient");

const getValidAccessToken = async (req, res) => {
    try {
        const token = await getValidToken();
        return res.status(200).json({
            status: "success",
            access_token: token,
        });
    } catch (err) {
        console.error("❌ Error getting valid access token:", err.message);
        return res.status(500).json({
            status: "error",
            message: "Failed to get valid access token",
            error: err.message,
        });
    }
};

module.exports = getValidAccessToken;