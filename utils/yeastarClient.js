const axios = require("axios");
const YeastarToken = require("../models/YeastarToken");

const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL; // e.g. https://cmedia.ras.yeastar.com/openapi/v1.0
const YEASTAR_USERNAME = process.env.YEASTAR_USERNAME;
const YEASTAR_PASSWORD = process.env.YEASTAR_PASSWORD;

/** 🔐 Step 1: Login to Yeastar */
async function loginToYeastar() {
  const url = `${YEASTAR_BASE_URL}/get_token`;
  console.log("🔑 Logging into Yeastar:", url);

  const res = await axios.post(url, {
    username: YEASTAR_USERNAME,
    password: YEASTAR_PASSWORD,
  });

  const data = res.data;
  if (data.access_token && data.refresh_token) {
    console.log("✅ Yeastar login success. Token received.");

    // Delete old token and store new one
    await YeastarToken.deleteMany({});
    await YeastarToken.create({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in || 1800, // default 30min
    });

    return data.access_token;
  }

  console.error("❌ Unexpected Yeastar login response:", data);
  throw new Error(data.errmsg || "Yeastar login failed");
}

/** ♻️ Step 2: Refresh token if expired */
async function refreshYeastarToken(oldRefreshToken) {
  const url = `${YEASTAR_BASE_URL}/refresh_token`;
  console.log("♻️ Refreshing Yeastar access token...");

  try {
    const res = await axios.post(url, {
      refresh_token: oldRefreshToken,
    });

    const data = res.data;
    if (data.access_token) {
      console.log("✅ Yeastar token refreshed successfully.");

      // Replace old token
      await YeastarToken.deleteMany({});
      await YeastarToken.create({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in || 1800,
      });

      return data.access_token;
    } else {
      console.error("❌ Refresh token failed:", data);
      throw new Error("Refresh token failed");
    }
  } catch (err) {
    console.error(
      "❌ Yeastar refresh failed:",
      err.response?.data || err.message
    );
    throw err;
  }
}

/** 🧠 Step 3: Get valid token from DB (refresh or re-login if needed) */
async function getValidToken() {
  const existing = await YeastarToken.findOne();

  if (!existing) {
    console.log("⚠️ No Yeastar token in DB — logging in...");
    return await loginToYeastar();
  }

  // Check if access token expired
  if (!existing.isExpired) {
    return existing.access_token;
  }

  // Try refresh token if available
  try {
    return await refreshYeastarToken(existing.refresh_token);
  } catch (refreshErr) {
    console.warn("⚠️ Refresh failed, logging in again...");
    return await loginToYeastar();
  }
}

/** 📋 Get all Yeastar extensions */
async function getYeastarExtensions() {
  const token = await getValidToken();
  const url = `${YEASTAR_BASE_URL}/extension/list?access_token=${token}`;

  try {
    const res = await axios.get(url);
    const data = res.data;

    if (data.errcode === 0 && Array.isArray(data.data)) return data.data;
    if (data.errcode === 0 && data.data?.list) return data.data.list;

    console.error("❌ Unexpected getYeastarExtensions response:", data);
    throw new Error(data.errmsg || "Failed to get extensions");
  } catch (err) {
    console.error("❌ getYeastarExtensions error:", err.message);
    throw err;
  }
}

/** 🔢 Find next available extension */
async function findNextAvailableExtension(start = 1001) {
  const existing = await getYeastarExtensions();
  const numbers = existing.map((ext) =>
    parseInt(ext.number || ext.extension, 10)
  );
  let next = start;
  while (numbers.includes(next)) next++;
  return next.toString();
}

/** 🔑 Generate random SIP secret */
function generateSecret(length = 12) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

/** 🧩 Create Yeastar extension */
async function createYeastarExtensionForUser(user) {
  const token = await getValidToken();
  const extensionNumber = await findNextAvailableExtension(1001);
  const secret = generateSecret();

  const url = `${YEASTAR_BASE_URL}/extension/create?access_token=${token}`;
  console.log("Creating Yeastar extension:", extensionNumber);

  const body = {
    number: extensionNumber.toString(),
    first_name: user.firstname || user?.email || "Voycell User", // ✅ added
    last_name: user.lastname || "", // ✅ added
    caller_id_name:
      `${user.firstname || ""} ${user.lastname || ""}`.trim() || "User",
    reg_name: extensionNumber.toString(),
    reg_password: secret,
    concurrent_registrations: 1,
    user_password: secret,
    type: "SIP",
    presence_status: "available",
    enable_outbound: true,
    enable_inbound: true,
    // ✅ New field required by Yeastar
    organization_list: [
      { value: "1" }, // use "1" or your actual organization ID
    ],
  };

  try {
    const res = await axios.post(url, body, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = res.data;
    if (data.errcode === 0) {
      console.log(
        "✅ Yeastar extension created successfully:",
        extensionNumber
      );
      return { extensionNumber, secret, result: data };
    }

    console.error("❌ Yeastar extension creation failed:", data);
    throw new Error(data.errmsg || "Yeastar extension creation failed");
  } catch (err) {
    console.error(
      "❌ Yeastar extension creation failed:",
      err.response?.data || err.message
    );
    throw err;
  }
}

module.exports = {
  getValidToken,
  createYeastarExtensionForUser,
  getYeastarExtensions,
  findNextAvailableExtension,
};
