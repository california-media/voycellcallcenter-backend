const axios = require("axios");

function buildZoomStartTime(date, time, timezone = "UTC") {
    if (!date) throw new Error("Meeting date is required");

    let dateStr;

    if (date instanceof Date) {
        // convert Date object to YYYY-MM-DD string
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");
        dateStr = `${yyyy}-${mm}-${dd}`;
    } else if (typeof date === "string") {
        dateStr = date;
    } else {
        throw new Error("Invalid date type");
    }

    const safeTime = time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";

    const iso = `${dateStr}T${safeTime}:00`;

    const d = new Date(iso);
    if (isNaN(d.getTime())) {
        throw new Error(`Invalid meeting date/time: ${iso}`);
    }

    return d.toISOString();
}

async function getZoomAccessToken(user) {
    // 1. Check if token is expired
    const now = Date.now();
    if (user.zoom.tokenExpiry && now < user.zoom.tokenExpiry) {
        return user.zoom.accessToken; // still valid
    }

    // 2. Refresh token
    const response = await axios.post("https://zoom.us/oauth/token", null, {
        params: {
            grant_type: "refresh_token",
            refresh_token: user.zoom.refreshToken,
        },
        auth: {
            username: process.env.ZOOM_CLIENT_ID,
            password: process.env.ZOOM_CLIENT_SECRET,
        },
    });

    // 3. Save new token to DB
    user.zoom.accessToken = response.data.access_token;
    user.zoom.refreshToken = response.data.refresh_token;
    user.zoom.tokenExpiry = Date.now() + response.data.expires_in * 1000;
    await user.save();

    return user.zoom.accessToken;
}



/**
 * Create Zoom Meeting (User-level OAuth)
 */
async function createZoomMeeting(user, meetingObj, timezone = "UTC") {
    if (!user?.zoom?.accessToken) {
        throw new Error("Zoom account not connected");
    }

    if (!meetingObj.meetingStartDate) {
        throw new Error("Meeting start date is missing");
    }

    const startTime = buildZoomStartTime(
        meetingObj.meetingStartDate,
        meetingObj.meetingStartTime,
        timezone
    );

    const response = await axios.post(
        "https://api.zoom.us/v2/users/me/meetings",
        {
            topic: meetingObj.meetingTitle || "Online Meeting",
            type: 2,
            start_time: startTime,
            timezone,
            duration: 30,
            settings: {
                join_before_host: false,
                waiting_room: true,
            },
        },
        {
            headers: {
                Authorization: `Bearer ${user.zoom.accessToken}`,
                "Content-Type": "application/json",
            },
        }
    );

    return {
        meetingId: response.data.id,
        joinUrl: response.data.join_url,
    };
}


module.exports = { createZoomMeeting, getZoomAccessToken };
