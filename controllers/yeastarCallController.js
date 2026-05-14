const axios = require("axios");
const YeastarToken = require("../models/YeastarToken");
const { getDeviceToken } = require("../services/yeastarTokenService");
const User = require("../models/userModel");
const Lead = require("../models/leadModel");
const Contact = require("../models/contactModel");
const mongoose = require("mongoose");


async function makeCallHandler(req, res) {
  console.log("[MakeCall] ▶ Request received — body:", JSON.stringify(req.body));
  try {
    const { caller_extension, mob_number, countryCode, assignedDeviceId, pbxBaseUrl } = req.body;

    console.log("[MakeCall] caller_extension:", caller_extension);
    console.log("[MakeCall] mob_number:", mob_number);
    console.log("[MakeCall] countryCode:", JSON.stringify(countryCode), "(empty = landline, no prefix)");
    console.log("[MakeCall] assignedDeviceId:", assignedDeviceId);

    if (!caller_extension || !mob_number) {
      console.error("[MakeCall] ❌ Missing required fields — caller_extension:", caller_extension, "mob_number:", mob_number);
      return res.status(400).json({
        status: "error",
        message: "caller_extension and mob_number are required",
      });
    }

 const token = await getDeviceToken(assignedDeviceId, "pbx");
console.log("[MakeCall] PBX token acquired:", token ? "✅ yes" : "❌ null/empty");

const rawNumber = String(mob_number || "");
console.log("[MakeCall] ── Number normalization ──────────────────────────");
console.log("[MakeCall]   rawNumber (as received):", rawNumber);

let normalizedNumber = rawNumber.replace(/\D/g, "");
console.log("[MakeCall]   digits only:", normalizedNumber);

// Remove UAE country code if present
if (normalizedNumber.startsWith("971")) {
  normalizedNumber = normalizedNumber.slice(3);
  console.log("[MakeCall]   stripped 971 prefix →", normalizedNumber);
}

// Ensure leading 0
if (!normalizedNumber.startsWith("0")) {
  normalizedNumber = "0" + normalizedNumber;
  console.log("[MakeCall]   added leading 0 →", normalizedNumber);
}

const normalizedCountryCode = countryCode
  ? String(countryCode).replace(/\D/g, "")
  : "";

console.log("[MakeCall]   normalizedNumber (final local format):", normalizedNumber);
console.log("[MakeCall]   normalizedCountryCode:", normalizedCountryCode || "(none)");

let callee = normalizedNumber; // default; may be overridden after ownerUser is resolved
    // ── START: find owner (user) by extensionNumber
    let ownerUser = null;
    try {
      ownerUser = await User.findOne({ "PBXDetails.PBX_EXTENSION_NUMBER": caller_extension }).select("_id PBXDetails").lean();
    } catch (dbErr) {
      ownerUser = null;
    }
    // ── END

    if (!ownerUser) {
      console.error("[MakeCall] ❌ Owner user not found for extension:", caller_extension);
      return res.status(400).json({ status: "error", message: "Caller extension not registered" });
    }
    console.log("[MakeCall] Owner user found:", ownerUser._id.toString());

    // If the caller's PBX telephone is a UAE landline (04XXXXXXXX), the PBX
    // requires the destination in local format (0XXXXXXXXX) — already set above.
    // For all other callers, pass the number exactly as received from the client.
    const pbxTelephone = (ownerUser.PBXDetails?.PBX_TELEPHONE || "").replace(/\D/g, "");
    const isLandlineCaller = pbxTelephone.startsWith("04");
    console.log("[MakeCall] ── Caller line check ─────────────────────────");
    console.log("[MakeCall]   PBX_TELEPHONE (raw):", ownerUser.PBXDetails?.PBX_TELEPHONE || "(not set)");
    console.log("[MakeCall]   PBX_TELEPHONE (digits):", pbxTelephone || "(not set)");
    console.log("[MakeCall]   isLandlineCaller (starts with 04):", isLandlineCaller);
    if (!isLandlineCaller) {
      callee = rawNumber;
      console.log("[MakeCall]   → Non-landline caller: using rawNumber as callee:", callee);
    } else {
      console.log("[MakeCall]   → Landline caller (04): using local format as callee:", callee);
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

      console.log("[MakeCall] ── DB lookup (countryCode:", normalizedCountryCode || "(none)", "| number:", normalizedNumber, ")");

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
      console.log("[MakeCall]   existingContact:", existingContact ? `found (_id: ${existingContact._id})` : "not found");

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
      console.log("[MakeCall]   existingLead:", existingLead ? `found (_id: ${existingLead._id})` : "not found");
    }
    // ── END


    // ── START: create lead if phone not found in either collection
    if (ownerUser && !existingContact && !existingLead) {
      console.log("[MakeCall]   → No contact/lead found — creating new lead for:", normalizedNumber);
      try {
        const newID = new mongoose.Types.ObjectId();
        const leadPayload = {
          _id: newID,
          contact_id: newID,
          firstname: "",
          lastname: "",
          phoneNumbers: [
            {
              countryCode: normalizedCountryCode || "",
              number: normalizedNumber
            }
          ],
          status: "interested",
          createdBy: ownerUser._id,
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
        console.log("[MakeCall]   ✅ Lead created — _id:", createdLead._id.toString());
      } catch (createErr) {
        console.error("[MakeCall]   ❌ Failed to create lead:", createErr.message);
      }
    } else {
      console.log("[MakeCall]   → Skipping lead creation (contact found:", !!existingContact, "| lead found:", !!existingLead, ")");
    }
    // ── END

    const callUrl = `/call/dial?access_token=${encodeURIComponent(token)}`;
    console.log("[MakeCall] PBX base URL:", PBX_BASE_URL);
    console.log("[MakeCall] PBX dial URL:", callUrl);

    const payload = {
      caller: caller_extension,
      callee,
      from_port: "auto",
      to_port: "auto",
      auto_answer: "no",
    };
    console.log("[MakeCall] PBX payload:", JSON.stringify(payload));

    const api = axios.create({
      baseURL: PBX_BASE_URL,
      headers: { "Content-Type": "application/json", "User-Agent": PBX_USER_AGENT },
      timeout: 15000,
    });

    let response;
    let data;

    try {
      console.log("[MakeCall] → Sending request to PBX...");
      response = await api.post(callUrl, payload);
      data = response.data;
      console.log("[MakeCall] ← PBX raw response:", JSON.stringify(data));

      // 🔥 If token expired → refresh + retry
      if (data?.errcode === 10004) {
        console.warn("[MakeCall] Token expired (errcode 10004) — refreshing token and retrying...");
        // 1️⃣ Delete old token
        await YeastarToken.deleteOne({ deviceId: assignedDeviceId });

        // 2️⃣ Get fresh token
        const newToken = await getDeviceToken(assignedDeviceId, "pbx");
        console.log("[MakeCall] New token acquired:", newToken ? "✅" : "❌");
        // 3️⃣ Retry call
        const retryUrl = `/call/dial?access_token=${encodeURIComponent(newToken)}`;
        response = await api.post(retryUrl, payload);
        data = response.data;
        console.log("[MakeCall] ← PBX retry response:", JSON.stringify(data));
      }

    } catch (apiErr) {
      console.error("[MakeCall] ❌ PBX API request threw an error:", apiErr.response?.data || apiErr.message);
      throw apiErr;
    }

    if (data?.errcode === 0 || data?.errmsg === "SUCCESS") {
      console.log("[MakeCall] ✅ Call initiated — callee:", callee);
      return res.status(200).json({
        status: "success",
        message: "Call initiated successfully",
        data,
      });
    } else {
      console.error("[MakeCall] ❌ PBX rejected call — callee:", callee, "| response:", JSON.stringify(data));
      return res.status(500).json({
        status: "error",
        message: "Failed to make call",
        error: data,
      });
    }
  } catch (err) {
    console.error("[MakeCall] ❌ Unhandled exception:", err.response?.data || err.message);
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
// async function getCallHandler(req, res) {
//   try {
//     const { call_id } = req.query;

//     if (!call_id) {
//       return res.status(400).json({
//         status: "error",
//         message: "call_id is required",
//       });
//     }

//     const token = await getValidToken();

//     const queryUrl = `/call/query?access_token=${encodeURIComponent(
//       token
//     )}&call_id=${encodeURIComponent(call_id)}`;

//     const response = await api.get(queryUrl);
//     const data = response.data;

//     if (data?.errcode === 0 || data?.errmsg === "SUCCESS") {
//       return res.status(200).json({
//         status: "success",
//         message: "Call details retrieved successfully",
//         data,
//       });
//     } else {
//       return res.status(500).json({
//         status: "error",
//         message: "Failed to retrieve call details",
//         error: data,
//       });
//     }
//   } catch (err) {
//     return res.status(500).json({
//       status: "error",
//       message: "Yeastar get call failed",
//       error: err.response?.data || err.message,
//     });
//   }
// }

module.exports = { makeCallHandler };
