const axios = require("axios");
const YeastarToken = require("../models/YeastarToken");

const BASE_URL = process.env.YEASTAR_BASE_URL; // e.g. https://cmedia.ras.yeastar.com/openapi/v1.0
const USERNAME = process.env.YEASTAR_USERNAME;
const PASSWORD = process.env.YEASTAR_PASSWORD;
const USER_AGENT = process.env.YEASTAR_USER_AGENT || "Mozilla/5.0";

const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
  timeout: 15000,
});

/**
 * Fetch or refresh valid token
 */
async function getValidToken() {
  let tokenDoc = await YeastarToken.findOne().sort({ created_at: -1 });

  // ✅ if token still valid
  if (tokenDoc && !tokenDoc.isExpired) {
    return tokenDoc.access_token;
  }

  // 🧠 otherwise login again via /get_token
  console.log("🔐 Requesting new token from Yeastar...");

  const body = {
    username: USERNAME,
    password: PASSWORD,
  };

  const res = await api.post("/get_token", body);
  const data = res.data;

  const access_token =
    data?.access_token || data?.data?.access_token || data?.token;
  const refresh_token =
    data?.refresh_token || data?.data?.refresh_token || null;
  const expires_in = data?.expires_in || data?.data?.expires_in || 1800;

  if (!access_token) {
    throw new Error("Failed to retrieve access_token from Yeastar");
  }

  await YeastarToken.deleteMany({});
  await YeastarToken.create({
    access_token,
    refresh_token,
    expires_in,
    created_at: new Date(),
  });

  console.log("✅ Token stored successfully");
  return access_token;
}

/**
 * Make a call via Yeastar PBX
 */
async function makeCallHandler(req, res) {
  try {
    const { caller_extension, mob_number, countryCode } = req.body;

    if (!caller_extension || !mob_number) {
      return res.status(400).json({
        status: "error",
        message: "caller_extension and mob_number are required",
      });
    }

    const token = await getValidToken();
    const callee = countryCode ? `${countryCode}${mob_number}` : mob_number;

    const callUrl = `/call/dial?access_token=${encodeURIComponent(token)}`;

    const payload = {
      caller: caller_extension,
      callee,
      from_port: "auto",
      to_port: "auto",
      auto_answer: "no",
    };

    console.log("📞 Making call to", callee, "via", callUrl);

    const response = await api.post(callUrl, payload);
    const data = response.data;
    console.log(data);

    if (data?.errcode === 0 || data?.errmsg === "SUCCESS") {
      return res.status(200).json({
        status: "success",
        message: "Call initiated successfully",
        data,
      });
    } else {
      return res.status(500).json({
        status: "error",
        message: "Failed to make call",
        error: data,
      });
    }
  } catch (err) {
    console.error(
      "❌ Yeastar make call error:",
      err.response?.data || err.message
    );
    return res.status(500).json({
      status: "error",
      message: "Yeastar make call failed",
      error: err.response?.data || err.message,
    });
  }
}

/**
 * Get call details via call ID
 */
async function getCallHandler(req, res) {
  try {
    const { call_id } = req.query;

    if (!call_id) {
      return res.status(400).json({
        status: "error",
        message: "call_id is required",
      });
    }

    const token = await getValidToken();

    const queryUrl = `/call/query?access_token=${encodeURIComponent(
      token
    )}&call_id=${encodeURIComponent(call_id)}`;

    console.log("📞 Querying call details for", call_id, "via", queryUrl);

    const response = await api.get(queryUrl);
    const data = response.data;
    console.log(data);

    if (data?.errcode === 0 || data?.errmsg === "SUCCESS") {
      return res.status(200).json({
        status: "success",
        message: "Call details retrieved successfully",
        data,
      });
    } else {
      return res.status(500).json({
        status: "error",
        message: "Failed to retrieve call details",
        error: data,
      });
    }
  } catch (err) {
    console.error(
      "❌ Yeastar get call error:",
      err.response?.data || err.message
    );
    return res.status(500).json({
      status: "error",
      message: "Yeastar get call failed",
      error: err.response?.data || err.message,
    });
  }
}

module.exports = { makeCallHandler, getCallHandler };
