const {
  searchPersonByPhone,
  createPerson,
  updatePerson,
  createNote,
  createMeeting,
} = require("./pipedriveApi.service");

/**
 * Syncs call data to Pipedrive after a call ends.
 * Mirrors the hubspotAfterCallSync / zohoAfterCallSync pattern.
 */
exports.pipedriveAfterCallSync = async ({ user, targetDoc, phone, status, note, meeting }) => {
  console.log("[Pipedrive Sync] Starting sync for phone:", phone);
  console.log("[Pipedrive Sync] user._id:", user._id);
  console.log("[Pipedrive Sync] tokenExpiresAt:", user.pipedrive?.tokenExpiresAt);

  try {
    // 1. Search for existing person by phone
    let person = await searchPersonByPhone(user, phone);
    let personId;

    if (person) {
      // 2a. Person exists — update
      personId = person.id;
      await updatePerson(user, personId, {
        firstname: targetDoc.firstname,
        lastname:  targetDoc.lastname,
        status,
      });
      console.log(`[Pipedrive Sync] Updated person: ${personId}`);
    } else {
      // 2b. Person doesn't exist — create
      const newPerson = await createPerson(user, {
        firstname: targetDoc.firstname,
        lastname:  targetDoc.lastname,
        phone,
        status,
      });
      personId = newPerson.id;
      console.log(`[Pipedrive Sync] Created person: ${personId}`);
    }

    // 3. Add note if provided
    if (note && personId) {
      await createNote(user, personId, note);
      console.log(`[Pipedrive Sync] Note added to person: ${personId}`);
    }

    // 4. Add meeting activity if provided
    if (meeting && personId) {
      console.log("[Pipedrive Sync] Meeting payload:", JSON.stringify(meeting, null, 2));
      await createMeeting(user, personId, {
        meetingTitle:       meeting.meetingTitle,
        meetingDescription: meeting.meetingDescription,
        meetingStartDate:   meeting.meetingStartDate,
        meetingStartTime:   meeting.meetingStartTime,
        meetingType:        meeting.meetingType,
        meetingLink:        meeting.meetingLink   || "",
        meetingLocation:    meeting.meetingLocation || "",
      });
      console.log(`[Pipedrive Sync] Meeting added to person: ${personId}`);
    }

    console.log("[Pipedrive Sync] Completed successfully.");
  } catch (err) {
    console.error("[Pipedrive Sync] Error status:", err?.response?.status);
    console.error("[Pipedrive Sync] Error data:", JSON.stringify(err?.response?.data, null, 2));
    console.error("[Pipedrive Sync] Error message:", err.message);
    throw err;
  }
};