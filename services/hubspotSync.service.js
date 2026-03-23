// services/hubspotSync.service.js
const {
  searchContactByPhone,
  createContact,
  updateContact,
  createNote,
  createMeeting,
} = require("./hubspotApi.service");

/**
 * Syncs call data to HubSpot after a call ends.
 * Mirrors the zohoAfterCallSync pattern.
 *
 * @param {Object} params
 * @param {Object} params.user         - Mongoose user document (with hubspot tokens)
 * @param {Object} params.targetDoc    - The lead/contact document saved locally
 * @param {string} params.phone        - Full phone string e.g. "+971501234567"
 * @param {string} params.status       - Call status
 * @param {string} params.note         - Call note
 * @param {Object} params.meeting      - Meeting object (optional)
 */


// exports.hubspotAfterCallSync = async ({ user, targetDoc, phone, status, note, meeting }) => {

//   try {
//     // 1. Search for existing contact in HubSpot by phone
//     let hubspotContact = await searchContactByPhone(user, phone);
//     let hubspotContactId;

//     if (hubspotContact) {
//       // 2a. Contact exists → update it
//       hubspotContactId = hubspotContact.id;

//       await updateContact(user, hubspotContactId, {
//         firstname: targetDoc.firstname,
//         lastname: targetDoc.lastname,
//         status,
//       });

//       console.log(`[HubSpot Sync] Updated contact: ${hubspotContactId}`);
//     } else {
//       // 2b. Contact doesn't exist → create it
//       const newContact = await createContact(user, {
//         firstname: targetDoc.firstname,
//         lastname: targetDoc.lastname,
//         phone,
//         status,
//       });

//       hubspotContactId = newContact.id;
//       console.log(`[HubSpot Sync] Created contact: ${hubspotContactId}`);
//     }

//     // 3. Add note if provided
//     if (note && hubspotContactId) {
//       await createNote(user, hubspotContactId, note);
//       console.log(`[HubSpot Sync] Note added to contact: ${hubspotContactId}`);
//     }

//     // 4. Add meeting if provided
//     if (meeting && hubspotContactId) {
//       await createMeeting(user, hubspotContactId, {
//         meetingTitle: meeting.meetingTitle,
//         meetingDescription: meeting.meetingDescription,
//         meetingStartDate: meeting.meetingStartDate,
//         meetingStartTime: meeting.meetingStartTime,
//         meetingType: meeting.meetingType,
//         meetingLink: meeting.meetingLink || "",
//         meetingLocation: meeting.meetingLocation || "",
//       });
//       console.log(`[HubSpot Sync] Meeting added to contact: ${hubspotContactId}`);
//     }

//     console.log("[HubSpot Sync] Completed successfully.");
//   } catch (err) {
//     // Non-blocking — log and continue
//     console.error("[HubSpot Sync] Error:", err?.response?.data || err.message);
//     throw err;
//   }
// };

exports.hubspotAfterCallSync = async ({ user, targetDoc, phone, status, note, meeting }) => {
  try {
    let hubspotContact = await searchContactByPhone(user, phone);
    let hubspotContactId;

    if (hubspotContact) {
      hubspotContactId = hubspotContact.id;
      await updateContact(user, hubspotContactId, {
        firstname: targetDoc.firstname,
        lastname: targetDoc.lastname,
        status,
      });
      console.log(`[HubSpot Sync] Updated contact: ${hubspotContactId}`);
    } else {
      const newContact = await createContact(user, {
        firstname: targetDoc.firstname,
        lastname: targetDoc.lastname,
        phone,
        status,
      });
      hubspotContactId = newContact.id;
      console.log(`[HubSpot Sync] Created contact: ${hubspotContactId}`);
    }

    if (note && hubspotContactId) {
      await createNote(user, hubspotContactId, note);
      console.log(`[HubSpot Sync] Note added`);
    }

    if (meeting && hubspotContactId) {
      // ✅ Log exactly what we're sending so you can see what's undefined
      console.log("[HubSpot Sync] Meeting payload being sent:", JSON.stringify(meeting, null, 2));

      await createMeeting(user, hubspotContactId, {
        meetingTitle: meeting.meetingTitle,
        meetingDescription: meeting.meetingDescription,
        meetingStartDate: meeting.meetingStartDate,
        meetingStartTime: meeting.meetingStartTime,
        meetingType: meeting.meetingType,
        meetingLink: meeting.meetingLink || "",
        meetingLocation: meeting.meetingLocation || "",
      });
      console.log(`[HubSpot Sync] Meeting added`);
    }

  } catch (err) {
    // ✅ Log the full HubSpot error response, not just err.message
    console.error("[HubSpot Sync] Error:", JSON.stringify(err?.response?.data, null, 2) || err.message);
    throw err;
  }
};