const Contact = require("../models/contactModel");
const User = require("../models/userModel");
const Lead = require("../models/leadModel");

const getProfileEvents = async (req, res) => {
  try {
    const userId = req.user._id;

    // ✅ Fetch user first to check Google connection
    // const user = await User.findById(userId);

    const user = await User.findById(userId).lean();

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized: User not found",
      });
    }

    let userIdsToFetch = [userId];

    // ✅ If company admin → include all agents
    if (user.role === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: userId,
      }).select("_id");

      const agentIds = agents.map((a) => a._id);

      userIdsToFetch = [userId, ...agentIds];
    }

    // Fetch both contacts and leads
    // const contacts = await Contact.find({ createdBy: userId });
    const contacts = await Contact.find({
      $or: [
        { createdBy: { $in: userIdsToFetch } },   // own + agents
        { assignedTo: { $in: userIdsToFetch } },  // assigned contacts
      ],
    });
    // const leads = await Lead.find({ createdBy: userId });
    const leads = await Lead.find({
      $or: [
        { createdBy: { $in: userIdsToFetch } },
        { assignedTo: { $in: userIdsToFetch } },
      ],
    });

    const allUserIds = new Set();

    contacts.forEach(c => {
      if (c.createdBy) allUserIds.add(c.createdBy.toString());
    });

    leads.forEach(l => {
      if (l.createdBy) allUserIds.add(l.createdBy.toString());
    });

    const users = await User.find({
      _id: { $in: Array.from(allUserIds) }
    }).select("firstname lastname role").lean();

    const userMap = new Map();

    users.forEach(u => {
      let user_role = "unknown";
      if (u.role === "user") {
        user_role = "Agent";
      } else if (u.role === "companyAdmin") {
        user_role = "Company Admin";
      }
      const fullName = `${u.firstname || ""} ${u.lastname || ""} (${user_role})`.trim();
      userMap.set(u._id.toString(), fullName);
    });

    const uniqueContactsMap = new Map();
    contacts.forEach(c => uniqueContactsMap.set(c._id.toString(), c));
    const uniqueContacts = Array.from(uniqueContactsMap.values());

    const uniqueLeadsMap = new Map();
    leads.forEach(l => uniqueLeadsMap.set(l._id.toString(), l));
    const uniqueLeads = Array.from(uniqueLeadsMap.values());

    const events = [];
    let skippedOnlineMeetings = false;

    // Process contacts
    uniqueContacts.forEach((contact) => {
      const contactName = `${contact.firstname || ""} ${contact.lastname || ""
        }`.trim();

      // ✅ Meetings
      if (Array.isArray(contact.meetings)) {
        contact.meetings.forEach((meeting) => {
          if (meeting.meetingStartDate) {
            if (meeting.meetingType === "online") {
              // ✅ Only include online meeting if user is Google-connected
              if (user.googleAccessToken && user.googleRefreshToken) {
                events.push({
                  type: "meeting",
                  category: "contact",
                  event_id: meeting.meeting_id,
                  contact_id: contact._id,
                  contact_name: contactName,
                  contact_email: contact.emailAddresses?.[0] || null,
                  title: meeting.meetingTitle,
                  description: meeting.meetingDescription || null,
                  start: meeting.meetingStartDate,
                  // end: meeting.meetingEndDate || meeting.meetingStartDate,
                  startTime: meeting.meetingStartTime || null,
                  // endTime: meeting.meetingEndTime || null,
                  color: "#2196F3",
                  location: meeting.meetingLocation || null,
                  link: meeting.meetingLink || null,
                  meetingType: meeting.meetingType,
                  owner_name: userMap.get(contact.createdBy?.toString()) || "Unknown",
                  createdAt: meeting.createdAt,
                  updatedAt: meeting.updatedAt,
                });
              } else {
                skippedOnlineMeetings = true;
              }
            } else {
              // ✅ Always include offline meetings
              events.push({
                type: "meeting",
                category: "contact",
                event_id: meeting.meeting_id,
                contact_id: contact._id,
                contact_name: contactName,
                title: meeting.meetingTitle,
                description: meeting.meetingDescription || null,
                contact_email: contact.emailAddresses?.[0] || null,

                start: meeting.meetingStartDate,
                // end: meeting.meetingEndDate || meeting.meetingStartDate,
                startTime: meeting.meetingStartTime || null,
                // endTime: meeting.meetingEndTime || null,
                color: "#2196F3",
                location: meeting.meetingLocation || null,
                link: meeting.meetingLink || null,
                meetingType: meeting.meetingType,
                owner_name: userMap.get(contact.createdBy?.toString()) || "Unknown",
                createdAt: meeting.createdAt,
                updatedAt: meeting.updatedAt,
              });
            }
          }
        });
      }
    });

    // Process leads
    uniqueLeads.forEach((lead) => {
      const leadName = `${lead.firstname || ""} ${lead.lastname || ""}`.trim();

      // ✅ Meetings
      if (Array.isArray(lead.meetings)) {
        lead.meetings.forEach((meeting) => {
          if (meeting.meetingStartDate) {
            if (meeting.meetingType === "online") {
              // ✅ Only include online meeting if user is Google-connected
              if (user.googleAccessToken && user.googleRefreshToken) {
                events.push({
                  type: "meeting",
                  category: "lead",
                  event_id: meeting.meeting_id,
                  contact_id: lead._id,
                  contact_name: leadName,
                  contact_email: lead.emailAddresses?.[0] || null,
                  title: meeting.meetingTitle,
                  description: meeting.meetingDescription || null,
                  start: meeting.meetingStartDate,
                  startTime: meeting.meetingStartTime || null,
                  color: "#2196F3",
                  location: meeting.meetingLocation || null,
                  link: meeting.meetingLink || null,
                  meetingType: meeting.meetingType,
                  owner_name: userMap.get(lead.createdBy?.toString()) || "Unknown",
                  createdAt: meeting.createdAt,
                  updatedAt: meeting.updatedAt,
                });
              } else {
                skippedOnlineMeetings = true;
              }
            } else {
              // ✅ Always include offline meetings
              events.push({
                type: "meeting",
                category: "lead",
                event_id: meeting.meeting_id,
                contact_id: lead._id,
                contact_name: leadName,
                title: meeting.meetingTitle,
                description: meeting.meetingDescription || null,
                start: meeting.meetingStartDate,
                startTime: meeting.meetingStartTime || null,
                color: "#2196F3",
                location: meeting.meetingLocation || null,
                link: meeting.meetingLink || null,
                meetingType: meeting.meetingType,
                owner_name: userMap.get(lead.createdBy?.toString()) || "Unknown",
                createdAt: meeting.createdAt,
                updatedAt: meeting.updatedAt,
              });
            }
          }
        });
      }
    });

    let finalMessage = "Profile Events Fetched";
    if (skippedOnlineMeetings) {
      finalMessage +=
        ". Some online meetings are hidden. Please connect your Google account to view them.";
    }

    return res.status(200).json({
      status: "success",
      message: finalMessage,
      data: events,
    });
  } catch (error) {
    console.error("Error fetching contact events:", error);
    return res.status(500).json({
      status: "error",
      message: "An error occurred while fetching contact events",
    });
  }
};

module.exports = {
  getProfileEvents,
};
