require("dotenv").config();

const { google } = require('googleapis');

async function createGoogleMeetEvent(user, meetingObj, timezone = 'UTC') {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  if (!user.googleAccessToken) {
    throw new Error("Google account not connected");
  }

  oauth2Client.setCredentials({
    access_token: user.googleAccessToken,
    refresh_token: user.googleRefreshToken,
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const event = {
    summary: meetingObj.meetingTitle || 'Online Meeting',
    description: meetingObj.meetingDescription || '',
    start: {
      dateTime: new Date(meetingObj.meetingStartDate).toISOString(),
      timeZone: timezone,
    },
    end: {
      dateTime: new Date(meetingObj.meetingEndDate || meetingObj.meetingStartDate).toISOString(),
      timeZone: timezone,
    },
    conferenceData: {
      createRequest: {
        requestId: `meet_${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
    });

    const meetLink = response.data?.hangoutLink;
    return meetLink || null;
  } catch (error) {
    console.error('Google Calendar API Error:', error);
    return null;
  }
}

module.exports = { createGoogleMeetEvent };
