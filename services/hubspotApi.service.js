// services/hubspotApi.service.js
const axios = require("axios");
const oauth = require("./hubspotOAuth.service");
const User = require("../models/userModel");

const API_BASE = "https://api.hubapi.com";

/**
 * Returns an axios instance with a valid (refreshed if needed) access token.
 * Automatically refreshes and saves the new token if expired.
 */
const getClient = async (user) => {
  let accessToken = user.hubspot.accessToken;

  // If token is expired (or expiring within 2 minutes), refresh it
  const now = new Date();
  const expiresAt = new Date(user.hubspot.tokenExpiresAt || 0);
  const twoMinutes = 2 * 60 * 1000;

  if (expiresAt - now < twoMinutes) {
    const newTokens = await oauth.refreshAccessToken(user.hubspot.refreshToken);

    accessToken = newTokens.access_token;

    // Save refreshed token to DB
    await User.findByIdAndUpdate(user._id, {
      "hubspot.accessToken": newTokens.access_token,
      "hubspot.tokenExpiresAt": new Date(Date.now() + newTokens.expires_in * 1000),
      ...(newTokens.refresh_token && {
        "hubspot.refreshToken": newTokens.refresh_token,
      }),
    });
  }

  return axios.create({
    baseURL: API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
};

/**
 * Get current HubSpot user (portal info)
 */
exports.getHubSpotCurrentUser = async (user) => {
  const client = await getClient(user);
  const response = await client.get("/oauth/v1/access-tokens/" + user.hubspot.accessToken);
  return response.data;
  // Returns: { hub_id, hub_domain, user, user_id, ... }
};

/**
 * Search for a contact by phone number
 */
exports.searchContactByPhone = async (user, phone) => {
  const client = await getClient(user);

  const response = await client.post("/crm/v3/objects/contacts/search", {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "phone",
            operator: "EQ",
            value: phone,
          },
        ],
      },
      {
        filters: [
          {
            propertyName: "mobilephone",
            operator: "EQ",
            value: phone,
          },
        ],
      },
    ],
    properties: ["firstname", "lastname", "phone", "mobilephone", "email", "hs_lead_status"],
    limit: 1,
  });

  return response.data.results?.[0] || null;
};

/**
 * Create a new contact in HubSpot
 */
exports.createContact = async (user, { firstname, lastname, phone, status }) => {
  const client = await getClient(user);

  const response = await client.post("/crm/v3/objects/contacts", {
    properties: {
      firstname: firstname || "",
      lastname: lastname || "",
      phone: phone,
      hs_lead_status: mapStatusToHubSpot(status),
    },
  });

  return response.data;
};

/**
 * Update an existing contact in HubSpot
 */
exports.updateContact = async (user, contactId, { firstname, lastname, status }) => {
  const client = await getClient(user);

  const response = await client.patch(`/crm/v3/objects/contacts/${contactId}`, {
    properties: {
      ...(firstname && { firstname }),
      ...(lastname && { lastname }),
      ...(status && { hs_lead_status: mapStatusToHubSpot(status) }),
    },
  });

  return response.data;
};

/**
 * Create a note and associate it with a contact
 */
// exports.createNote = async (user, contactId, noteBody) => {
//   const client = await getClient(user);

//   const response = await client.post("/crm/v3/objects/notes", {
//     properties: {
//       hs_note_body: noteBody,
//       hs_timestamp: new Date().toISOString(),
//     },
//     associations: [
//       {
//         to: { id: contactId },
//         types: [
//           {
//             associationCategory: "HUBSPOT_DEFINED",
//             associationTypeId: 202, // Note → Contact
//           },
//         ],
//       },
//     ],
//   });

//   return response.data;
// };


// exports.createMeeting = async (user, contactId, meetingObj) => {
//   const client = await getClient(user);

//   // Build start/end timestamps
//   const startDateTime = buildMeetingTimestamp(
//     meetingObj.meetingStartDate,
//     meetingObj.meetingStartTime
//   );
//   const endDateTime = startDateTime + 60 * 60 * 1000; // Default: 1 hour duration

//   const response = await client.post("/crm/v3/objects/meetings", {
//     properties: {
//       hs_meeting_title: meetingObj.meetingTitle || "Call Follow-up",
//       hs_meeting_body: meetingObj.meetingDescription || "",
//       hs_meeting_start_time: new Date(startDateTime).toISOString(),
//       hs_meeting_end_time: new Date(endDateTime).toISOString(),
//       hs_meeting_location:
//         meetingObj.meetingType === "online"
//           ? meetingObj.meetingLink || ""
//           : meetingObj.meetingLocation || "",
//       hs_meeting_outcome: "SCHEDULED",
//     },
//     associations: [
//       {
//         to: { id: contactId },
//         types: [
//           {
//             associationCategory: "HUBSPOT_DEFINED",
//             associationTypeId: 200, // Meeting → Contact
//           },
//         ],
//       },
//     ],
//   });

//   return response.data;
// };

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Map your internal status to HubSpot lead status values
 */





/**
 * Create a note associated with a contact (uses engagements API)
 */
/**
 * Create a note associated with a contact
 * associationTypeId 202 = note_to_contact ✅ confirmed in docs
 */
exports.createNote = async (user, contactId, noteBody) => {
  const client = await getClient(user);

  const response = await client.post("/crm/v3/objects/notes", {
    properties: {
      hs_note_body: noteBody,
      hs_timestamp: new Date().toISOString(), // Required field
    },
    associations: [
      {
        to: { id: contactId },
        types: [
          {
            associationCategory: "HUBSPOT_DEFINED",
            associationTypeId: 202, // note_to_contact ✅
          },
        ],
      },
    ],
  });

  return response.data;
};

/**
 * Create a meeting associated with a contact
 * associationTypeId 200 = meeting_to_contact ✅ confirmed in docs
 */
// exports.createMeeting = async (user, contactId, meetingObj) => {
//   const client = await getClient(user);

//   const startDateTime = buildMeetingTimestamp(
//     meetingObj.meetingStartDate,
//     meetingObj.meetingStartTime
//   );
//   const endDateTime = startDateTime + 60 * 60 * 1000; // 1 hour duration

//   const startISO = new Date(startDateTime).toISOString();
//   const endISO = new Date(endDateTime).toISOString();

//   const response = await client.post("/crm/v3/objects/meetings", {
//     properties: {
//       hs_timestamp: startISO,           // Required field ✅
//       hs_meeting_title: meetingObj.meetingTitle || "Call Follow-up",
//       hs_meeting_body: meetingObj.meetingDescription || "",
//       hs_meeting_start_time: startISO,
//       hs_meeting_end_time: endISO,
//       hs_meeting_location:
//         meetingObj.meetingType === "online"
//           ? meetingObj.meetingLink || ""
//           : meetingObj.meetingLocation || "",
//       hs_meeting_outcome: "SCHEDULED",
//     },
//     associations: [
//       {
//         to: { id: contactId },
//         types: [
//           {
//             associationCategory: "HUBSPOT_DEFINED",
//             associationTypeId: 200, // meeting_to_contact ✅
//           },
//         ],
//       },
//     ],
//   });

//   return response.data;
// };

exports.createMeeting = async (user, contactId, meetingObj) => {
  const client = await getClient(user);

  const startDateTime = buildMeetingTimestamp(
    meetingObj.meetingStartDate,
    meetingObj.meetingStartTime
  );
  const endDateTime = startDateTime + 60 * 60 * 1000;

  const startISO = new Date(startDateTime).toISOString();
  const endISO = new Date(endDateTime).toISOString();

  const payload = {
    properties: {
      hs_timestamp: startISO,
      hs_meeting_title: meetingObj.meetingTitle || "Call Follow-up",
      hs_meeting_body: meetingObj.meetingDescription || "",
      hs_meeting_start_time: startISO,
      hs_meeting_end_time: endISO,
      hs_meeting_location:
        meetingObj.meetingType === "online"
          ? meetingObj.meetingLink || ""
          : meetingObj.meetingLocation || "",
      hs_meeting_outcome: "SCHEDULED",
    },
    associations: [
      {
        to: { id: contactId },
        types: [
          {
            associationCategory: "HUBSPOT_DEFINED",
            associationTypeId: 200,
          },
        ],
      },
    ],
  };

  // ✅ Log the exact payload so you can verify in server console
  console.log("[HubSpot] Creating meeting with payload:", JSON.stringify(payload, null, 2));

  try {
    const response = await client.post("/crm/v3/objects/meetings", payload);
    return response.data;
  } catch (err) {
    // ✅ Log the full HubSpot validation error
    console.error("[HubSpot] Meeting creation failed:", JSON.stringify(err?.response?.data, null, 2));
    throw err;
  }
};

// ✅ Safer timestamp builder — handles all edge cases
const buildMeetingTimestamp = (dateStr, timeStr) => {
  if (!dateStr) {
    console.warn("[HubSpot] meetingStartDate is missing, using current time");
    return Date.now();
  }

  try {
    const dateOnly = dateStr.substring(0, 10); // "2026-03-25"

    let time24 = "09:00"; // default fallback

    if (timeStr) {
      const upperTime = timeStr.trim().toUpperCase(); // "03:03 PM"

      if (upperTime.includes("AM") || upperTime.includes("PM")) {
        // ✅ Convert 12-hour to 24-hour
        const [timePart, modifier] = upperTime.split(" ");
        let [hours, minutes] = timePart.split(":").map(Number);

        if (modifier === "AM") {
          if (hours === 12) hours = 0; // 12:xx AM → 00:xx
        } else {
          if (hours !== 12) hours += 12; // x:xx PM → x+12:xx (except 12 PM)
        }

        time24 = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      } else {
        // Already 24-hour format e.g. "13:01"
        time24 = timeStr.trim().substring(0, 5);
      }
    }

    const combined = `${dateOnly}T${time24}:00`;
    const ts = new Date(combined).getTime();

    if (isNaN(ts)) {
      console.warn("[HubSpot] Invalid timestamp after parse, using current time. Input:", dateStr, timeStr);
      return Date.now();
    }

    console.log(`[HubSpot] Parsed meeting time: ${combined} → ${new Date(ts).toISOString()}`);
    return ts;

  } catch (e) {
    console.warn("[HubSpot] Timestamp parse error, using current time:", e.message);
    return Date.now();
  }
};


const mapStatusToHubSpot = (status) => {
  const map = {
    interested: "IN_PROGRESS",
    callBack: "OPEN",
    callSuccess: "CONNECTED",
    notInterested: "UNQUALIFIED",
    noAnswer: "ATTEMPTED_TO_CONTACT",
    busy: "ATTEMPTED_TO_CONTACT",
  };
  return map[status] || "NEW";
};

/**
 * Build a UTC timestamp from date string (YYYY-MM-DD) and time string (HH:MM)
 */
// const buildMeetingTimestamp = (dateStr, timeStr) => {
//   if (!dateStr) return Date.now();
//   const combined = timeStr ? `${dateStr}T${timeStr}:00` : `${dateStr}T09:00:00`;
//   return new Date(combined).getTime();
// };

exports.getClient = getClient;