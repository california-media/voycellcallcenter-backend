const User = require("../models/userModel");
const YeastarToken = require("../models/YeastarToken");
const { getValidToken } = require("../utils/yeastarClient");
const axios = require("axios");

const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL?.trim();
const YEASTAR_SDK_ACCESS_ID = process.env.YEASTAR_SDK_ACCESS_ID?.trim();
const YEASTAR_SDK_ACCESS_KEY = process.env.YEASTAR_SDK_ACCESS_KEY?.trim();

/**
 * Get valid access token for Linkus SDK API calls
 * Uses cached token from DB if still valid, otherwise requests new one
 */
// async function getValidToken() {
//   try {
//     // Try to get existing token from database
//     const existingToken = await YeastarToken.findOne().sort({ created_at: -1 });

//     // Check if token exists and is not expired (with 5 minute buffer)
//     if (existingToken) {
//       const expiryTime =
//         new Date(existingToken.created_at).getTime() +
//         (existingToken.expires_in - 300) * 1000;
//       const isExpired = Date.now() > expiryTime;

//       if (!isExpired) {
//         console.log("✅ Using cached Linkus SDK access token from database");
//         return existingToken.access_token;
//       } else {
//         console.log("⏰ Cached token expired, requesting new one...");
//       }
//     }

//     // Request new token using SDK AccessID and AccessKey
//     console.log("🔐 Requesting new Linkus SDK access token...");
//     const response = await axios.post(`${YEASTAR_BASE_URL}/get_token`, {
//       username: YEASTAR_SDK_ACCESS_ID,
//       password: YEASTAR_SDK_ACCESS_KEY,
//     });

//     const data = response.data;

//     if (data.errcode !== 0) {
//       throw new Error(data.errmsg || "Failed to get access token");
//     }

//     const access_token = data.access_token;
//     const refresh_token = data.refresh_token;
//     const expires_in = data.access_token_expire_time || 1800;

//     // Save new token to database (delete old tokens first)
//     await YeastarToken.deleteMany({});
//     await YeastarToken.create({
//       access_token,
//       refresh_token,
//       expires_in,
//     });

//     console.log(
//       "✅ New Linkus SDK access token obtained and cached in database"
//     );
//     return access_token;
//   } catch (err) {
//     console.error("❌ Failed to get access token:", err.message);
//     throw new Error("Failed to get access token");
//   }
// }

/**
 * Get Yeastar login signature for user
 */
// async function getYeastarSignature(extensionNumber) {
//   try {
//     const accessToken = await getValidToken();

//     console.log(
//       "🔑 Requesting login signature for extension to attach with user:",
//       extensionNumber
//     );

//     const signatureUrl = `${YEASTAR_BASE_URL}/sign/create?access_token=${accessToken}`;
//     const signResponse = await axios.post(signatureUrl, {
//       username: extensionNumber,
//       sign_type: "sdk",
//       expire_time: 0, // No expiration
//     });

//     const signData = signResponse.data;

//     if (signData.errcode !== 0) {
//       console.error("❌ Signature creation failed:", signData);
//       throw new Error(signData.errmsg || "Failed to create login signature");
//     }

//     const signature = signData.data?.sign;

//     if (!signature) {
//       throw new Error("No signature returned from Yeastar");
//     }

//     // Extract base URL
//     const baseUrl = YEASTAR_BASE_URL || "";
//     const pbxURL = baseUrl.replace(/\/openapi\/v[0-9.]+$/i, "");

//     console.log(
//       "✅ Generated Yeastar login signature for extension:",
//       extensionNumber
//     );

//     return {
//       signature,
//       pbxURL,
//     };
//   } catch (err) {
//     console.error("❌ Error generating Yeastar signature:", err.message);
//     return null;
//   }
// }

const getUserData = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();

    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }
    // --------- Normalize phonenumbers for response based on apiType ----------
    const phonenumbersForResponse = (() => {
      const phones = Array.isArray(user.phonenumbers) ? user.phonenumbers : [];

      return phones
        .map((p) => {
          if (!p) return null;

          if (typeof p === "string") {
            // strip '+', spaces, parentheses, dashes, etc -> digits only
            return p.replace(/[^\d]/g, "");
          }

          // if stored as object { countryCode, number } (or similar)
          const cc = String(p.countryCode || p.country || "").replace(
            /[^\d]/g,
            ""
          );
          const num = String(
            p.number || p.nationalNumber || p.phone || ""
          ).replace(/[^\d]/g, "");

          // If only `number` exists but already contains country code (e.g., "9170..."), return it cleaned
          if (!cc && num.length > 6) {
            return num;
          }

          // join cc + num (safe even if one of them is empty)
          return (cc + num).replace(/[^\d]/g, "");
        })
        .filter(Boolean); // remove null/empty entries

      // For mobile (or by default) return raw stored structure so mobile UI keeps objects
      return phones;
    })();

    // Fetch Yeastar signature if user has extension
    // let yeastarSignature = null;
    // let pbxURL = null;

    // if (user.extensionNumber && user.yeastarExtensionId) {
    //   try {
    //     const signatureData = await getYeastarSignature(user.extensionNumber);
    //     if (signatureData) {
    //       yeastarSignature = signatureData.signature;
    //       pbxURL = signatureData.pbxURL;
    //     }
    //   } catch (err) {
    //     console.error("❌ Failed to fetch Yeastar signature for user:", err);
    //     // Don't fail the whole request if signature fetch fails
    //   }
    // }

    const data = {
      id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      gender: user.gender,
      email: user.email,
      profileImageURL: user.profileImageURL,
      instagram: user.instagram,
      linkedin: user.linkedin,
      telegram: user.telegram,
      twitter: user.twitter,
      facebook: user.facebook,
      designation: user.designation,
      signupMethod: user.signupMethod,
      role: user.role,
      referredBy: user.referredBy || null,
      myReferrals: user.myReferrals || [],
      referralCode: user.referralCode || null,
      isActive: user.isActive,
      lastSeen: user.lastSeen,
      phonenumbers: phonenumbersForResponse,

      isVerified: user.isVerified,
      userInfo: user.userInfo || {
        helps: [],
        goals: "",
        categories: "",
        employeeCount: "",
        companyName: "",
      },
      extensionNumber: user.extensionNumber || null,
      yeastarExtensionId: user.yeastarExtensionId || null,
      sipSecret: user.sipSecret || null,
      yeastarProvisionStatus: user.yeastarProvisionStatus || "pending",
      yeastarProvisionError: user.yeastarProvisionError || "",
      // yeastarSignature: yeastarSignature,
      // pbxURL: pbxURL,
    };

    return res.json({
      status: "success",
      message: "User data fetched successfully.",
      data,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
};

module.exports = { getUserData };
