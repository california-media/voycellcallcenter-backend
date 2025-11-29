// const axios = require("axios");
// const YeastarToken = require("../models/YeastarToken");

// const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL; // e.g. https://cmedia.ras.yeastar.com/openapi/v1.0
// const YEASTAR_USERNAME = process.env.YEASTAR_USERNAME;
// const YEASTAR_PASSWORD = process.env.YEASTAR_PASSWORD;

// /** 🔐 Step 1: Login to Yeastar */
// async function loginToYeastar() {
//   const url = `${YEASTAR_BASE_URL}/get_token`;
//   console.log("🔑 Logging into Yeastar:", url);

//   const res = await axios.post(url, {
//     username: YEASTAR_USERNAME,
//     password: YEASTAR_PASSWORD,
//   });

//   const data = res.data;
//   if (data.access_token && data.refresh_token) {
//     console.log("✅ Yeastar login success. Token received.");

//     // Delete old token and store new one
//     await YeastarToken.deleteMany({});
//     await YeastarToken.create({
//       access_token: data.access_token,
//       refresh_token: data.refresh_token,
//       expires_in: data.expires_in || 1800, // default 30min
//     });

//     return data.access_token;
//   }

//   console.error("❌ Unexpected Yeastar login response:", data);
//   throw new Error(data.errmsg || "Yeastar login failed");
// }

// /** ♻️ Step 2: Refresh token if expired */
// async function refreshYeastarToken(oldRefreshToken) {
//   const url = `${YEASTAR_BASE_URL}/refresh_token`;
//   console.log("♻️ Refreshing Yeastar access token...");

//   try {
//     const res = await axios.post(url, {
//       refresh_token: oldRefreshToken,
//     });

//     const data = res.data;
//     if (data.access_token) {
//       console.log("✅ Yeastar token refreshed successfully.");

//       // Replace old token
//       await YeastarToken.deleteMany({});
//       await YeastarToken.create({
//         access_token: data.access_token,
//         refresh_token: data.refresh_token,
//         expires_in: data.expires_in || 1800,
//       });
//       console.log(data.access_token);

//       return data.access_token;
//     } else {
//       console.error("❌ Refresh token failed:", data);
//       throw new Error("Refresh token failed");
//     }
//   } catch (err) {
//     console.error(
//       "❌ Yeastar refresh failed:",
//       err.response?.data || err.message
//     );
//     throw err;
//   }
// }

// /** 🧠 Step 3: Get valid token from DB (refresh or re-login if needed) */
// async function getValidToken() {
//   const existing = await YeastarToken.findOne();

//   if (!existing) {
//     console.log("⚠️ No Yeastar token in DB — logging in...");
//     return await loginToYeastar();
//   }

//   // Check if access token expired
//   if (!existing.isExpired) {
//     return existing.access_token;
//   }

//   // Try refresh token if available
//   try {
//     return await refreshYeastarToken(existing.refresh_token);
//   } catch (refreshErr) {
//     console.warn("⚠️ Refresh failed, logging in again...");
//     return await loginToYeastar();
//   }
// }

// /** 📋 Get all Yeastar extensions */
// async function getYeastarExtensions() {
//   const token = await getValidToken();
//   console.log(token);

//   const url = `${YEASTAR_BASE_URL}/extension/list?access_token=${token}`;

//   try {
//     const res = await axios.get(url);
//     const data = res.data;

//     if (data.errcode === 0 && Array.isArray(data.data)) return data.data;
//     if (data.errcode === 0 && data.data?.list) return data.data.list;
//     console.log(data.data.list);

//     console.error("❌ Unexpected getYeastarExtensions response:", data);
//     throw new Error(data.errmsg || "Failed to get extensions");
//   } catch (err) {
//     console.error("❌ getYeastarExtensions error:", err.message);
//     throw err;
//   }
// }

// /** 🔢 Find next available extension */
// async function findNextAvailableExtension(start = 1001) {
//   const existing = await getYeastarExtensions();
//   const numbers = existing.map((ext) =>
//     parseInt(ext.number || ext.extension, 10)
//   );
//   let next = start;
//   while (numbers.includes(next)) next++;
//   return next.toString();
// }

// /** 🔑 Generate random SIP secret */
// function generateSecret(length = 12) {
//   const chars =
//     "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
//   return Array.from(
//     { length },
//     () => chars[Math.floor(Math.random() * chars.length)]
//   ).join("");
// }

// // /** 🧩 Create Yeastar extension */
// // async function createYeastarExtensionForUser(user) {
// //   const token = await getValidToken();
// //   const extensionNumber = await findNextAvailableExtension(1001);
// //   const secret = generateSecret();

// //   const url = `${YEASTAR_BASE_URL}/extension/create?access_token=${token}`;
// //   console.log("Creating Yeastar extension:", extensionNumber);

// //   const body = {
// //     number: extensionNumber.toString(),
// //     first_name: user.firstname || user?.email || "Voycell User", // ✅ added
// //     last_name: user.lastname || "", // ✅ added
// //     caller_id_name:
// //       `${user.firstname || ""} ${user.lastname || ""}`.trim() || "User",
// //     reg_name: extensionNumber.toString(),
// //     reg_password: secret,
// //     concurrent_registrations: 1,
// //     user_password: secret,
// //     type: "SIP",
// //     presence_status: "available",
// //     enable_outbound: true,
// //     enable_inbound: true,
// //     // ✅ New field required by Yeastar
// //     organization_list: [
// //       { value: "1" }, // use "1" or your actual organization ID
// //     ],
// //   };

// //   try {
// //     const res = await axios.post(url, body, {
// //       headers: { Authorization: `Bearer ${token}` },
// //     });

// //     const data = res.data;
// //     if (data.errcode === 0) {
// //       console.log(
// //         "✅ Yeastar extension created successfully:",
// //         extensionNumber
// //       );
// //       return { extensionNumber, secret, result: data };
// //     }

// //     console.error("❌ Yeastar extension creation failed:", data);
// //     throw new Error(data.errmsg || "Yeastar extension creation failed");
// //   } catch (err) {
// //     console.error(
// //       "❌ Yeastar extension creation failed:",
// //       err.response?.data || err.message
// //     );
// //     throw err;
// //   }
// // }

// async function createYeastarExtensionForUser(user) {
//   const token = await getValidToken();
//   const extensionNumber = await findNextAvailableExtension(1001);
//   const secret = generateSecret();

//   const url = `${YEASTAR_BASE_URL}/extension/create?access_token=${token}`;
//   console.log("Creating Yeastar extension:", extensionNumber);

//   const body = {
//     number: extensionNumber.toString(),
//     first_name: user.firstname || user?.email || "Voycell User",
//     last_name: user.lastname || "",
//     caller_id_name:
//       `${user.firstname || ""} ${user.lastname || ""}`.trim() || "User",
//     reg_name: extensionNumber.toString(),
//     reg_password: secret,
//     concurrent_registrations: 1,
//     user_password: secret,
//     type: "SIP",
//     presence_status: "available",
//     enable_outbound: true,
//     enable_inbound: true,
//     // 🚫 Remove organization_list unless you are sure about it
//   };

//   try {
//     const res = await axios.post(url, body);
//     const data = res.data;

//     if (data.errcode === 0) {
//       console.log("✅ Yeastar extension created:", extensionNumber);
//       return { extensionNumber, secret, result: data };
//     }

//     console.error("❌ Yeastar extension creation failed:", data);
//     throw new Error(data.errmsg || "Yeastar extension creation failed");
//   } catch (err) {
//     console.error("❌ Yeastar extension creation failed:", err.response?.data || err.message);
//     throw err;
//   }
// }

// module.exports = {
//   getValidToken,
//   createYeastarExtensionForUser,
//   getYeastarExtensions,
//   findNextAvailableExtension,
// };

const axios = require("axios");
const moment = require("moment");
const YeastarToken = require("../models/YeastarToken");

const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL; // e.g. https://cmedia.ras.yeastar.com/openapi/v1.0
const YEASTAR_USERNAME = process.env.YEASTAR_USERNAME;
const YEASTAR_PASSWORD = process.env.YEASTAR_PASSWORD;

/**
 * 🔐 Step 1: Login to Yeastar and get a new token
 */
async function loginToYeastar() {
  const url = `${YEASTAR_BASE_URL}/get_token`;
  console.log("🔑 Logging into Yeastar:", url);

  try {
    const res = await axios.post(url, {
      username: YEASTAR_USERNAME,
      password: YEASTAR_PASSWORD,
    });
    const data = res.data;

    if (data.access_token && data.refresh_token) {
      console.log("✅ Yeastar login success. Token received.");

      // Store new token in DB
      await YeastarToken.deleteMany({});
      const expiry = moment()
        .add(data.expires_in || 1800, "seconds")
        .toDate();

      await YeastarToken.create({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: expiry,
      });

      return data.access_token;
    }

    console.error("❌ Unexpected Yeastar login response:", data);
    throw new Error(data.errmsg || "Yeastar login failed");
  } catch (err) {
    console.error("❌ Yeastar login error:", err.response?.data || err.message);
    throw err;
  }
}

/**
 * ♻️ Step 2: Refresh the token if expired
 */
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

      const expiry = moment()
        .add(data.expires_in || 1800, "seconds")
        .toDate();

      await YeastarToken.deleteMany({});
      await YeastarToken.create({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: expiry,
      });

      return data.access_token;
    }

    throw new Error("Refresh token failed");
  } catch (err) {
    console.error(
      "❌ Yeastar refresh failed:",
      err.response?.data || err.message
    );
    throw err;
  }
}

/**
 * 🧠 Step 3: Validate if current token is still working
 */
async function isTokenValid(token) {
  try {
    const url = `${YEASTAR_BASE_URL}/extension/list?access_token=${token}`;
    const res = await axios.get(url);
    return res.data.errcode === 0;
  } catch (err) {
    if (err.response?.data?.errcode === 10005) {
      console.warn("⚠️ Token invalid or expired (ACCESS DENIED)");
    }
    return false;
  }
}

/**
 * 🧠 Step 4: Get valid token from DB (relogin if invalid)
 */
async function getValidToken() {
  const existing = await YeastarToken.findOne();

  // If no token in DB → login
  if (!existing) {
    console.log("⚠️ No Yeastar token in DB — logging in...");
    return await loginToYeastar();
  }

  // Check if time expired
  const now = new Date();
  if (existing.expires_at && now > existing.expires_at) {
    console.log("⚠️ Yeastar token expired — refreshing...");
    try {
      return await refreshYeastarToken(existing.refresh_token);
    } catch (err) {
      console.log("⚠️ Refresh failed, relogging...");
      return await loginToYeastar();
    }
  }

  // Validate with Yeastar API
  const stillValid = await isTokenValid(existing.access_token);
  if (!stillValid) {
    console.log("⚠️ Stored Yeastar token invalid — getting new one...");
    return await loginToYeastar();
  }

  return existing.access_token;
}

/**
 * 📋 Get all Yeastar extensions
 */
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
    console.error(
      "❌ getYeastarExtensions error:",
      err.response?.data || err.message
    );
    throw err;
  }
}

/**
 * 🔢 Find next available extension
 */
async function findNextAvailableExtension(start = 1001) {
  const existing = await getYeastarExtensions();
  const numbers = existing.map((ext) =>
    parseInt(ext.number || ext.extension, 10)
  );
  let next = start;
  while (numbers.includes(next)) next++;
  return next.toString();
}

/**
 * 🔑 Generate random SIP secret
 */
function generateSecret(length = 12) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

/**
 * 🧩 Create Yeastar extension for a user
 */
// async function createYeastarExtensionForUser(user) {
//   const token = await getValidToken();
//   const extensionNumber = await findNextAvailableExtension(1001);
//   const secret = generateSecret();
//   console.log(token);

//   const url = `${YEASTAR_BASE_URL}/extension/create?access_token=${token}`;
//   console.log("Creating Yeastar extension:", extensionNumber, user?.email);

//   const body = {
//     number: extensionNumber.toString(),
//     first_name:
//       user.firstname + " Voycell" || user?.email + " Voycell" || "Voycell", // ✅ added
//     last_name:
//       user?.role === "user"
//         ? "agent"
//         : user?.role === "companyAdmin"
//           ? "companyAdmin"
//           : user?.role === "superadmin"
//             ? "superadmin"
//             : "",
//     caller_id_name:
//       `${user.firstname || ""} ${user.lastname || ""}`.trim() || "User",
//     reg_name: extensionNumber.toString(),
//     reg_password: secret,
//     concurrent_registrations: 1,
//     user_password: secret,
//     type: "SIP",
//     presence_status: "available",
//     enable_outbound: true,
//     enable_inbound: true,
//     // ✅ New field required by Yeastar
//     organization_list: [
//       { value: "1" }, // use "1" or your actual organization ID
//     ],
//   };

//   try {
//     const res = await axios.post(url, body);
//     const data = res.data;

//     if (data.errcode === 0) {
//       console.log("✅ Yeastar extension created:", extensionNumber);
//       return { extensionNumber, secret, result: data };
//     }

//     console.error("❌ Yeastar extension creation failed:", data);
//     throw new Error(data.errmsg || "Yeastar extension creation failed");
//   } catch (err) {
//     console.error(
//       "❌ Yeastar extension creation failed:",
//       err.response?.data || err.message
//     );
//     throw err;
//   }
// }

async function createYeastarExtensionForUser(user) {
  const token = await getValidToken();
  const extensionNumber = await findNextAvailableExtension(1001);
  const secret = generateSecret();

  const url = `${YEASTAR_BASE_URL}/extension/create?access_token=${token}`;

  const body = {
    number: extensionNumber.toString(),

    first_name:
      `${user.firstname || user.email.split("@")[0]} Voycell`,

    last_name:
      user?.role === "user"
        ? "agent"
        : user?.role === "companyAdmin"
          ? "companyAdmin"
          : user?.role === "superadmin"
            ? "superadmin"
            : "",

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

    organization_list: [
      { value: "1" },
    ],
  };

  try {
    const res = await axios.post(url, body);
    const data = res.data;

    // ✅ SUCCESS
    if (data.errcode === 0) {
      console.log("✅ Yeastar extension created:", extensionNumber);

      return {
        extensionNumber,
        secret,
        result: data,
      };
    }

    // ✅ HANDLE LIMIT ERROR SAFELY
    if (data.errcode === 60002) {
      console.error("❌ Yeastar limit reached");

      return {
        extensionNumber: null,
        secret: null,
        result: {
          errcode: 60002,
          errmsg: "Extension limit reached on Yeastar",
        },
      };
    }

    // ✅ OTHER YEASTAR ERRORS
    console.error("❌ Yeastar API error:", data);

    return {
      extensionNumber: null,
      secret: null,
      result: data,
    };

  } catch (err) {
    console.error(
      "❌ Yeastar request failed:",
      err.response?.data || err.message
    );

    throw new Error("Yeastar network failure");
  }
}


/**
 * 🗑️ Delete Yeastar extension
 */
async function deleteYeastarExtension(extensionId) {
  const token = await getValidToken();
  const url = `${YEASTAR_BASE_URL}/extension/delete?id=${extensionId}&access_token=${token}`;

  console.log("Deleting Yeastar extension:", extensionId);

  try {
    const res = await axios.get(url);
    const data = res.data;

    if (data.errcode === 0) {
      console.log("✅ Yeastar extension deleted successfully:", extensionId);
      return { success: true, result: data };
    }

    console.error("❌ Yeastar extension deletion failed:", data);
    throw new Error(data.errmsg || "Yeastar extension deletion failed");
  } catch (err) {
    console.error(
      "❌ Yeastar extension deletion error:",
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
  deleteYeastarExtension,
};
