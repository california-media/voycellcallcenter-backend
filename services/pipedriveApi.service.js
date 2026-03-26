const axios = require("axios");
const oauth = require("./pipedriveOAuth.service");
const User = require("../models/userModel");

/**
 * Returns an axios instance with a valid (auto-refreshed) access token.
 * Uses the user's own api_domain as base URL.
 */
const getClient = async (user) => {
  let accessToken = user.pipedrive.accessToken;

  const now      = new Date();
  const expiresAt = new Date(user.pipedrive.tokenExpiresAt || 0);
  const twoMinutes = 2 * 60 * 1000;

  if (expiresAt - now < twoMinutes) {
    console.log("[Pipedrive getClient] Token expired, refreshing...");

    if (!user.pipedrive.refreshToken) {
      throw new Error("Pipedrive refresh token missing — user must reconnect");
    }

    const newTokens = await oauth.refreshAccessToken(user.pipedrive.refreshToken);
    accessToken = newTokens.access_token;

    await User.findByIdAndUpdate(user._id, {
      "pipedrive.accessToken":    newTokens.access_token,
      "pipedrive.tokenExpiresAt": new Date(Date.now() + newTokens.expires_in * 1000),
      ...(newTokens.refresh_token && {
        "pipedrive.refreshToken": newTokens.refresh_token,
      }),
      ...(newTokens.api_domain && {
        "pipedrive.apiBaseUrl": newTokens.api_domain,
      }),
    });

    console.log("[Pipedrive getClient] Token refreshed and saved");
  }

  // Use stored api_domain as base URL — each Pipedrive account has its own domain
  const baseURL = user.pipedrive.apiBaseUrl || "https://api.pipedrive.com";

  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
};

/**
 * Get current Pipedrive user info
 */
exports.getPipedriveCurrentUser = async (user) => {
  const client = await getClient(user);
  const response = await client.get("/v1/users/me");
  return response.data.data;
  // Returns: { id, name, email, company_id, company_domain, ... }
};

/**
 * Search for a person (contact) by phone number
 */
exports.searchPersonByPhone = async (user, phone) => {
  const client = await getClient(user);

  const response = await client.get("/v1/persons/search", {
    params: {
      term:        phone,
      fields:      "phone",
      exact_match: true,
      limit:       1,
    },
  });

  return response.data.data?.items?.[0]?.item || null;
};

/**
 * Create a new person (contact) in Pipedrive
 */
exports.createPerson = async (user, { firstname, lastname, phone, status }) => {
  const client = await getClient(user);

  const response = await client.post("/v1/persons", {
    name:  `${firstname || ""} ${lastname || ""}`.trim() || "Unknown",
    phone: [{ value: phone, primary: true }],
    label: mapStatusToPipedrive(status),
  });

  return response.data.data;
};

/**
 * Update an existing person in Pipedrive
 */
exports.updatePerson = async (user, personId, { firstname, lastname, status }) => {
  const client = await getClient(user);

  const response = await client.put(`/v1/persons/${personId}`, {
    name:  `${firstname || ""} ${lastname || ""}`.trim() || undefined,
    label: mapStatusToPipedrive(status),
  });

  return response.data.data;
};

/**
 * Create a note attached to a person
 */
exports.createNote = async (user, personId, noteContent) => {
  const client = await getClient(user);

  const response = await client.post("/v1/notes", {
    content:   noteContent,   // HTML or plain text
    person_id: personId,
  });

  return response.data.data;
};

/**
 * Create a meeting activity attached to a person
 * Pipedrive uses Activities for meetings — type = "meeting"
 */
exports.createMeeting = async (user, personId, meetingObj) => {
  const client = await getClient(user);

  const { dueDate, dueTime } = buildActivityDateTime(
    meetingObj.meetingStartDate,
    meetingObj.meetingStartTime
  );

  const location =
    meetingObj.meetingType === "online"
      ? meetingObj.meetingLink || ""
      : meetingObj.meetingLocation || "";

  const response = await client.post("/v1/activities", {
    subject:   meetingObj.meetingTitle    || "Call Follow-up",
    note:      meetingObj.meetingDescription || "",
    type:      "meeting",
    due_date:  dueDate,        // "YYYY-MM-DD"
    due_time:  dueTime,        // "HH:MM"
    duration:  "01:00",        // 1 hour default
    person_id: personId,
    done:      0,
    location,
  });

  return response.data.data;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map internal call status → Pipedrive person label
 */
const mapStatusToPipedrive = (status) => {
  const map = {
    interested:     "hot",
    callBack:       "warm",
    callSuccess:    "hot",
    notInterested:  "cold",
    noAnswer:       "warm",
    busy:           "warm",
  };
  return map[status] || null;
};

/**
 * Build due_date (YYYY-MM-DD) and due_time (HH:MM) for Pipedrive activity
 * Handles both 12-hour (01:01 PM) and 24-hour (13:01) input formats
 */
const buildActivityDateTime = (dateStr, timeStr) => {
  const dueDate = dateStr ? dateStr.substring(0, 10) : new Date().toISOString().substring(0, 10);

  let dueTime = "09:00"; // default fallback

  if (timeStr) {
    const upperTime = timeStr.trim().toUpperCase();

    if (upperTime.includes("AM") || upperTime.includes("PM")) {
      const [timePart, modifier] = upperTime.split(" ");
      let [hours, minutes] = timePart.split(":").map(Number);

      if (modifier === "AM") {
        if (hours === 12) hours = 0;
      } else {
        if (hours !== 12) hours += 12;
      }

      dueTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    } else {
      dueTime = timeStr.trim().substring(0, 5); // Already HH:MM
    }
  }

  console.log(`[Pipedrive] Activity datetime: ${dueDate} ${dueTime}`);
  return { dueDate, dueTime };
};

exports.getClient = getClient;