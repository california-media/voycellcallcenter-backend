const Contact = require("../models/contactModel");
const User = require("../models/userModel");
const Lead = require("../models/leadModel");

const getProfileEvents = async (req, res) => {
    try {
        const userId = req.user._id;

        // ✅ Fetch user first to check Google connection
        const user = await User.findById(userId);
        if (!user) {
            return res.status(401).json({
                status: "error",
                message: "Unauthorized: User not found",
            });
        }

        const category = req.body.category;

        if (!category) {
            return res.status(400).json({
                status: "error",
                message: "Category is required",
            });
        }

        var Model;
        if (category === "lead") {
            Model = Lead;
        } else {
            Model = Contact;
        }

        const contacts = await Model.find({ createdBy: userId });


        const events = [];
        let skippedOnlineMeetings = false;

        contacts.forEach((contact) => {
            const contactName = `${contact.firstname || ""} ${contact.lastname || ""}`.trim();

            // ✅ Meetings
            if (Array.isArray(contact.meetings)) {
                contact.meetings.forEach((meeting) => {
                    if (meeting.meetingStartDate) {
                        if (meeting.meetingType === "online") {
                            // ✅ Only include online meeting if user is Google-connected
                            if (user.googleAccessToken && user.googleRefreshToken) {
                                events.push({
                                    type: "meeting",
                                    event_id: meeting.meeting_id,
                                    contact_id: contact._id,
                                    contact_name: contactName,
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
                                event_id: meeting.meeting_id,
                                contact_id: contact._id,
                                contact_name: contactName,
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
            finalMessage += ". Some online meetings are hidden. Please connect your Google account to view them.";
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

