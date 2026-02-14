const axios = require("axios");
const YeastarToken = require("../models/YeastarToken");
// const { getValidToken } = require("../utils/yeastarClient");
const { getDeviceToken } = require("../services/yeastarTokenService");
const User = require("../models/userModel");
const Lead = require("../models/leadModel");
const Contact = require("../models/contactModel");
const mongoose = require("mongoose");

// const BASE_URL = process.env.YEASTAR_BASE_URL; // e.g. https://cmedia.ras.yeastar.com/openapi/v1.0
// const USERNAME = process.env.YEASTAR_USERNAME;
// const PASSWORD = process.env.YEASTAR_PASSWORD;
// const USER_AGENT = process.env.YEASTAR_USER_AGENT || "Mozilla/5.0";



/**
 * Make a call via Yeastar PBX
 */
// async function makeCallHandler(req, res) {
//   try {
//     const { caller_extension, mob_number, countryCode, assignedDeviceId, pbxBaseUrl } = req.body;

//     if (!caller_extension || !mob_number) {
//       return res.status(400).json({
//         status: "error",
//         message: "caller_extension and mob_number are required",
//       });
//     }

//     const token = await getDeviceToken(assignedDeviceId, "pbx");
//     const callee = countryCode ? `${countryCode}${mob_number}` : mob_number;
//     console.log("📞 Making call with payload:", { caller_extension, callee, assignedDeviceId, pbxBaseUrl });
//     const rawNumber = String(mob_number || "");
//     const normalizedNumber = rawNumber.replace(/\D/g, ""); // e.g. "9876543210"
//     // also normalise country code (keep as-is if absent)
//     const normalizedCountryCode = countryCode ? String(countryCode).replace(/\D/g, "") : "";

//     // ── START: find owner (user) by extensionNumber
//     let ownerUser = null;
//     try {
//       ownerUser = await User.findOne({ "PBXDetails.PBX_EXTENSION_NUMBER": caller_extension }).select("_id PBXDetails").lean();
//     } catch (dbErr) {
//       console.warn("Warning: error looking up owner by extension:", dbErr);
//       ownerUser = null;
//     }
//     // ── END

//     if (!ownerUser) {
//       return res.status(400).json({ status: "error", message: "Caller extension not registered" });
//     }

//     // ── START: check existing contact/lead for this owner
//     let existingContact = null;
//     let existingLead = null;
//     let PBX_BASE_URL = "";
//     let PBX_USER_AGENT = "";

//     if (ownerUser) {
//       console.log("Found owner user for extension:", ownerUser._id);
//       const ownerId = ownerUser._id;
//       PBX_BASE_URL = ownerUser.PBXDetails.PBX_BASE_URL || "";
//       // let PBX_USERNAME = ownerUser.PBXDetails.PBX_USERNAME || "";
//       // let PBX_PASSWORD = ownerUser.PBXDetails.PBX_PASSWORD || "";
//       // let PBX_SDK_ACCESS_ID = ownerUser.PBXDetails.PBX_SDK_ACCESS_ID || "";
//       // let PBX_SDK_ACCESS_KEY = ownerUser.PBXDetails.PBX_SDK_ACCESS_KEY || "";
//       PBX_USER_AGENT = ownerUser.PBXDetails.PBX_USER_AGENT || "";
//       // let PBX_EXTENSION_NUMBER = ownerUser.PBXDetails.PBX_EXTENSION_NUMBER || "";
//       // let PBX_TELEPHONE = ownerUser.PBXDetails.PBX_TELEPHONE || "";

//       // look in Contact
//       existingContact = await Contact.findOne({
//         createdBy: ownerId,
//         phoneNumbers: {
//           $elemMatch: {
//             countryCode: normalizedCountryCode,
//             number: normalizedNumber
//           }
//         }
//       }).lean();

//       console.log("Existing contact found:", existingContact);

//       // look in Lead
//       existingLead = await Lead.findOne({
//         createdBy: ownerId,
//         phoneNumbers: {
//           $elemMatch: {
//             countryCode: normalizedCountryCode,
//             number: normalizedNumber
//           }
//         }
//       }).lean();
//     }

//     console.log("Existing lead found:", existingLead);
//     // ── END


//     // ── START: create lead if phone not found in either collection
//     if (ownerUser && !existingContact && !existingLead) {
//       try {
//         const newID = new mongoose.Types.ObjectId();
//         const leadPayload = {
//           _id: newID,
//           contact_id: newID,
//           firstname: "", // optional — you can leave blank or populate if available
//           lastname: "",
//           phoneNumbers: [
//             {
//               countryCode: normalizedCountryCode || "",
//               number: normalizedNumber
//             }
//           ],
//           status: "interested",
//           createdBy: ownerUser._id,
//           // optional: add an activity log entry
//           activities: [
//             {
//               action: "lead_created_via_call_api",
//               type: "lead",
//               title: "Lead created from call",
//               description: `Phone ${normalizedCountryCode ? "+" + normalizedCountryCode : ""}${normalizedNumber}`,
//               timestamp: new Date()
//             }
//           ]
//         };

//         const createdLead = await Lead.create(leadPayload);
//         console.log("➕ Created new lead for number:", createdLead._id);
//       } catch (createErr) {
//         console.error("Failed to create lead for number:", createErr);
//       }
//     }
//     // ── END

//     const callUrl = `/call/dial?access_token=${encodeURIComponent(token)}`;

//     const payload = {
//       caller: caller_extension,
//       callee,
//       from_port: "auto",
//       to_port: "auto",
//       auto_answer: "no",
//     };

//     console.log("📞 Making call to", callee, "via", callUrl);

//     const api = axios.create({
//       baseURL: PBX_BASE_URL,
//       headers: { "Content-Type": "application/json", "User-Agent": PBX_USER_AGENT },
//       timeout: 15000,
//     });

//     // const response = await api.post(callUrl, payload);
//     // const data = response.data;
//     // console.log(data);

//     let response;
//     let data;

//     try {
//       // response = await api.post(callUrl, payload);
//       // data = response.data;
//       // console.log("📞 First attempt response:", data);

//       // 🔥 If token expired → refresh + retry
//       if (data?.errcode === 10004) {
//         console.log("🔄 Token expired. Regenerating new token...");

//         // 1️⃣ Delete old token
//         await YeastarToken.deleteOne({ deviceId: assignedDeviceId });

//         // 2️⃣ Get fresh token
//         const newToken = await getDeviceToken(assignedDeviceId, "pbx");

//         // 3️⃣ Retry call
//         // const retryUrl = `/call/dial?access_token=${encodeURIComponent(newToken)}`;
//         // response = await api.post(retryUrl, payload);
//         // data = response.data;

//         // console.log("📞 Retry response:", data);
//       }

//     } catch (apiErr) {
//       console.error("❌ Call API error:", apiErr.response?.data || apiErr.message);
//       throw apiErr;
//     }

//     if (data?.errcode === 0 || data?.errmsg === "SUCCESS") {
//       return res.status(200).json({
//         status: "success",
//         message: "Call initiated successfully",
//         data,
//       });
//     } else {
//       return res.status(500).json({
//         status: "error",
//         message: "Failed to make call",
//         error: data,
//       });
//     }
//   } catch (err) {
//     console.error(
//       "❌ Yeastar make call error:",
//       err.response?.data || err.message
//     );
//     return res.status(500).json({
//       status: "error",
//       message: "Yeastar make call failed",
//       error: err.response?.data || err.message,
//     });
//   }
// }

async function makeCallHandler(req, res) {
  try {
    const { caller_extension, mob_number, countryCode, assignedDeviceId, pbxBaseUrl } = req.body;

    if (!caller_extension || !mob_number) {
      return res.status(400).json({
        status: "error",
        message: "caller_extension and mob_number are required",
      });
    }

    const token = await getDeviceToken(assignedDeviceId, "pbx");
    const callee = countryCode ? `${countryCode}${mob_number}` : mob_number;
    console.log("📞 Making call with payload:", { caller_extension, callee, assignedDeviceId, pbxBaseUrl });
    const rawNumber = String(mob_number || "");
    const normalizedNumber = rawNumber.replace(/\D/g, ""); // e.g. "9876543210"
    // also normalise country code (keep as-is if absent)
    const normalizedCountryCode = countryCode ? String(countryCode).replace(/\D/g, "") : "";

    // ── START: find owner (user) by extensionNumber
    let ownerUser = null;
    try {
      ownerUser = await User.findOne({ "PBXDetails.PBX_EXTENSION_NUMBER": caller_extension }).select("_id PBXDetails").lean();
    } catch (dbErr) {
      console.warn("Warning: error looking up owner by extension:", dbErr);
      ownerUser = null;
    }
    // ── END

    if (!ownerUser) {
      return res.status(400).json({ status: "error", message: "Caller extension not registered" });
    }

    // ── START: check existing contact/lead for this owner
    let existingContact = null;
    let existingLead = null;
    let PBX_BASE_URL = "";
    let PBX_USER_AGENT = "";

    if (ownerUser) {
      const ownerId = ownerUser._id;
      PBX_BASE_URL = ownerUser.PBXDetails.PBX_BASE_URL || "";
      // let PBX_USERNAME = ownerUser.PBXDetails.PBX_USERNAME || "";
      // let PBX_PASSWORD = ownerUser.PBXDetails.PBX_PASSWORD || "";
      // let PBX_SDK_ACCESS_ID = ownerUser.PBXDetails.PBX_SDK_ACCESS_ID || "";
      // let PBX_SDK_ACCESS_KEY = ownerUser.PBXDetails.PBX_SDK_ACCESS_KEY || "";
      PBX_USER_AGENT = ownerUser.PBXDetails.PBX_USER_AGENT || "";
      // let PBX_EXTENSION_NUMBER = ownerUser.PBXDetails.PBX_EXTENSION_NUMBER || "";
      // let PBX_TELEPHONE = ownerUser.PBXDetails.PBX_TELEPHONE || "";

      // look in Contact
      existingContact = await Contact.findOne({
        createdBy: ownerId,
        phoneNumbers: {
          $elemMatch: {
            countryCode: normalizedCountryCode,
            number: normalizedNumber
          }
        }
      }).lean();

      // look in Lead
      existingLead = await Lead.findOne({
        createdBy: ownerId,
        phoneNumbers: {
          $elemMatch: {
            countryCode: normalizedCountryCode,
            number: normalizedNumber
          }
        }
      }).lean();
    }
    // ── END


    // ── START: create lead if phone not found in either collection
    if (ownerUser && !existingContact && !existingLead) {
      try {
        const newID = new mongoose.Types.ObjectId();
        const leadPayload = {
          _id: newID,
          contact_id: newID,
          firstname: "", // optional — you can leave blank or populate if available
          lastname: "",
          phoneNumbers: [
            {
              countryCode: normalizedCountryCode || "",
              number: normalizedNumber
            }
          ],
          status: "interested",
          createdBy: ownerUser._id,
          // optional: add an activity log entry
          activities: [
            {
              action: "lead_created_via_call_api",
              type: "lead",
              title: "Lead created from call",
              description: `Phone ${normalizedCountryCode ? "+" + normalizedCountryCode : ""}${normalizedNumber}`,
              timestamp: new Date(),
            }
          ]
        };

        const createdLead = await Lead.create(leadPayload);
        console.log("➕ Created new lead for number:", createdLead._id);
      } catch (createErr) {
        console.error("Failed to create lead for number:", createErr);
      }
    }
    // ── END

    const callUrl = `/call/dial?access_token=${encodeURIComponent(token)}`;

    const payload = {
      caller: caller_extension,
      callee,
      from_port: "auto",
      to_port: "auto",
      auto_answer: "no",
    };

    console.log("📞 Making call to", callee, "via", callUrl);

    const api = axios.create({
      baseURL: PBX_BASE_URL,
      headers: { "Content-Type": "application/json", "User-Agent": PBX_USER_AGENT },
      timeout: 15000,
    });

    // const response = await api.post(callUrl, payload);
    // const data = response.data;
    // console.log(data);

    let response;
    let data;

    try {
      response = await api.post(callUrl, payload);
      data = response.data;
      console.log("📞 First attempt response:", data);

      // 🔥 If token expired → refresh + retry
      if (data?.errcode === 10004) {
        console.log("🔄 Token expired. Regenerating new token...");

        // 1️⃣ Delete old token
        await YeastarToken.deleteOne({ deviceId: assignedDeviceId });

        // 2️⃣ Get fresh token
        const newToken = await getDeviceToken(assignedDeviceId, "pbx");

        // 3️⃣ Retry call
        const retryUrl = `/call/dial?access_token=${encodeURIComponent(newToken)}`;
        response = await api.post(retryUrl, payload);
        data = response.data;

        console.log("📞 Retry response:", data);
      }

    } catch (apiErr) {
      console.error("❌ Call API error:", apiErr.response?.data || apiErr.message);
      throw apiErr;
    }

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
