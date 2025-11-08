const mongoose = require("mongoose");
const Contact = require("../models/contactModel");
const User = require("../models/userModel");
const { createGoogleMeetEvent } = require("../utils/googleCalendar.js");
const { logActivityToContact } = require("../utils/activityLogger");

/**
 * @route   POST /contacts/meeting
 * @desc    Add or update a meeting (online or offline) for a contact
 * @access  Private
 */
exports.addOrUpdateMeeting = async (req, res) => {
  try {
    const {
      contact_id,
      meeting_id,
      meetingTitle,
      meetingDescription,
      meetingStartDate,
      meetingStartTime,
      meetingType,
      meetingLocation,
      timezone = "UTC", // Default timezone
    } = req.body;

    const user_id = req.user._id;
    const user = await User.findById(user_id);

    console.log(user);

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required.",
      });
    }

    const contact = await Contact.findById(contact_id);
    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Contact not found.",
      });
    }

    const meetingProvided =
      meetingTitle ||
      meetingDescription ||
      meetingStartDate ||
      meetingStartTime ||
      meetingType;

    if (!meetingProvided) {
      return res.status(400).json({
        status: "error",
        message: "No meeting fields provided.",
      });
    }

    // ✅ Validate Google Account connection for online meeting
    if (meetingType === "online") {
      if (!user?.googleAccessToken || !user?.googleRefreshToken) {
        return res.status(400).json({
          status: "error",
          message: "Connect Google Account for online meeting scheduling.",
        });
      }
    }
    console.log(user.googleAccessToken);

    let meetingObj = {};
    const isUpdating = !!meeting_id;

    // ---------- UPDATE EXISTING MEETING ----------
    if (isUpdating) {
      const existingMeeting = contact.meetings.find(
        (m) => m.meeting_id.toString() === meeting_id
      );

      if (!existingMeeting) {
        return res.status(404).json({
          status: "error",
          message: "Meeting not found for this contact.",
        });
      }

      const oldType = existingMeeting.meetingType;

      // ✅ Fill update fields
      if (meetingTitle) existingMeeting.meetingTitle = meetingTitle;
      if (meetingDescription)
        existingMeeting.meetingDescription = meetingDescription;
      if (meetingStartDate) existingMeeting.meetingStartDate = meetingStartDate;
      if (meetingStartTime) existingMeeting.meetingStartTime = meetingStartTime;
      if (meetingType) existingMeeting.meetingType = meetingType;

      // ✅ Handle type changes
      if (oldType === "offline" && meetingType === "online") {
        try {
          if (!existingMeeting.meetingStartDate) {
            console.error("Start Date missing during offline → online change");
          } else {
            const generatedLink = await createGoogleMeetEvent(
              user,
              existingMeeting,
              timezone
            );
            if (generatedLink) existingMeeting.meetingLink = generatedLink;
          }
        } catch (err) {
          console.error("Google Meet creation failed:", err);
        }
        existingMeeting.meetingLocation = undefined;
      }

      if (oldType === "online" && meetingType === "offline") {
        existingMeeting.meetingLink = undefined;
        existingMeeting.meetingLocation = meetingLocation || "";
      }

      if (oldType === "online" && meetingType === "online") {
        delete existingMeeting.meetingLocation;
      }

      if (oldType === "offline" && meetingType === "offline") {
        existingMeeting.meetingLocation = meetingLocation || "";
        delete existingMeeting.meetingLink;
      }

      existingMeeting.updatedAt = new Date();
    }

    // ---------- CREATE NEW MEETING ----------
    else {
      meetingObj.meeting_id = new mongoose.Types.ObjectId();
      meetingObj.createdAt = new Date();

      if (meetingTitle) meetingObj.meetingTitle = meetingTitle;
      if (meetingDescription) meetingObj.meetingDescription = meetingDescription;
      if (meetingStartDate) meetingObj.meetingStartDate = meetingStartDate;
      if (meetingStartTime) meetingObj.meetingStartTime = meetingStartTime;
      meetingObj.meetingType = meetingType || "offline";

      if (meetingType === "offline" && meetingLocation) {
        meetingObj.meetingLocation = meetingLocation;
      }

      if (meetingType === "online") {
        try {
          if (!meetingObj.meetingStartDate) {
            console.error(
              "Meeting Start Date missing for new online meeting creation!"
            );
          } else {
            const generatedLink = await createGoogleMeetEvent(
              user,
              meetingObj,
              timezone
            );
            if (generatedLink) {
              meetingObj.meetingLink = generatedLink;
            }
          }
        } catch (error) {
          console.error("Failed to create Google Meet link:", error);
        }
      }

      contact.meetings.push(meetingObj);
    }

    await contact.save();

    return res.status(200).json({
      status: "success",
      message: isUpdating
        ? "Meeting updated successfully."
        : "Meeting added successfully.",
      data: contact.meetings,
    });
  } catch (error) {
    console.error("Error in addOrUpdateMeeting:", error);
    return res.status(500).json({
      status: "error",
      message: "Server error. Please try again.",
      error: error.message,
    });
  }
};

exports.deleteMeeting = async (req, res) => {
  const { contact_id, meeting_id } = req.body;

  if (!mongoose.Types.ObjectId.isValid(contact_id)) {
    return res.status(400).json({
      status: "error",
      message: "Invalid contact ID",
    });
  }

  try {
    // 1️⃣ Find the contact first (to get the meeting title)
    const contact = await Contact.findOne({
      _id: contact_id,
      createdBy: req.user._id,
      "meetings.meeting_id": meeting_id,
    });

    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Meeting not found in this contact or unauthorized access",
      });
    }

    // 2️⃣ Get the meeting title
    const meeting = contact.meetings.find(m => m.meeting_id === meeting_id);
    const meetingTitle = meeting ? meeting.title : "Untitled Meeting";

    // 3️⃣ Delete the meeting
    await Contact.updateOne(
      { _id: contact_id },
      { $pull: { meetings: { meeting_id } } }
    );

    // 4️⃣ Log meeting deletion activity with title instead of ID
    await logActivityToContact(contact_id, {
      action: "meeting_deleted",
      type: "meeting",
      title: "Meeting Deleted",
      description: `${meetingTitle}`,
    });

    return res.status(200).json({
      status: "success",
      message: "Meeting Deleted",
      data: { meeting_id },
    });

  } catch (error) {
    console.error("Delete Meeting Error:", error);
    return res.status(500).json({
      status: "error",
      message: "An error occurred while deleting the meeting",
    });
  }
};
