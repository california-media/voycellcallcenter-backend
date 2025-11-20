const mongoose = require("mongoose");
const Contact = require("../models/contactModel");
const User = require("../models/userModel");
const Lead = require("../models/leadModel");
const { createGoogleMeetEvent } = require("../utils/googleCalendar.js");
const { logActivityToContact } = require("../utils/activityLogger");

/**
 * @route   GET /meeting/getAll
 * @desc    Get all meetings for a contact with optional sorting
 * @access  Private
 * @query   contact_id (required), sortBy (optional: 'ascending' or 'descending'), filterBy (optional: 'online', 'offline', 'all')
 */
exports.getMeetingsForContact = async (req, res) => {
  try {
    const { contact_id, sortBy, filterBy, category } = req.body;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required.",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(contact_id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid contact_id format.",
      });
    }
    if (category && category !== "contact" && category !== "lead") {
      return res.status(400).json({
        status: "error",
        message: "category must be either 'contact' or 'lead' if provided",
      });
    }
    if (!category) {
      return res.status(400).json({
        status: "error",
        message: "category is required: contact or lead",
      });
    }
    var Model;
    if (category === "lead") {
      Model = Lead;
    } else {
      Model = Contact;
    }

    const contact = await Model.findById(contact_id);
    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Contact not found.",
      });
    }

    let meetings = [...contact.meetings];

    // Filter meetings based on type
    if (filterBy === "online") {
      meetings = meetings.filter((meeting) => meeting.meetingType === "online");
    } else if (filterBy === "offline") {
      meetings = meetings.filter(
        (meeting) => meeting.meetingType === "offline"
      );
    }
    // 'all' or no filterBy returns all meetings

    // Sort meetings by start date
    if (sortBy === "ascending") {
      meetings.sort((a, b) => {
        const dateA = a.meetingStartDate || a.createdAt;
        const dateB = b.meetingStartDate || b.createdAt;
        return new Date(dateA) - new Date(dateB);
      });
    } else if (sortBy === "descending") {
      meetings.sort((a, b) => {
        const dateA = a.meetingStartDate || a.createdAt;
        const dateB = b.meetingStartDate || b.createdAt;
        return new Date(dateB) - new Date(dateA);
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Meetings retrieved successfully.",
      data: {
        meetings,
        totalMeetings: meetings.length,
        onlineMeetings: contact.meetings.filter(
          (m) => m.meetingType === "online"
        ).length,
        offlineMeetings: contact.meetings.filter(
          (m) => m.meetingType === "offline"
        ).length,
      },
    });
  } catch (error) {
    console.error("Error in getMeetingsForContact:", error);
    return res.status(500).json({
      status: "error",
      message: "Server error. Please try again.",
      error: error.message,
    });
  }
};

/**
 * @route   POST /contacts/meeting
 * @desc    Add or update a meeting (online or offline) for a contact
 * @access  Private
 */

exports.addOrUpdateMeeting = async (req, res) => {
  try {
    const {
      category,            // "contact" or "lead"
      contact_id,
      meeting_id,
      meetingTitle,
      meetingDescription,
      meetingStartDate,
      meetingStartTime,
      meetingType,
      meetingLocation,
      timezone = "UTC",
    } = req.body;

    const user_id = req.user._id;
    const user = await User.findById(user_id);

    if (!category || !["contact", "lead"].includes(category.toLowerCase())) {
      return res.status(400).json({
        status: "error",
        message: "category is required: contact or lead",
      });
    }

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required.",
      });
    }

    // ---------------------------------------------------------
    // SELECT MODEL BASED ON CATEGORY
    // ---------------------------------------------------------
    const Model = category === "lead" ? Lead : Contact;

    const record = await Model.findById(contact_id);
    if (!record) {
      return res.status(404).json({
        status: "error",
        message: `${category} not found.`,
      });
    }

    // ---------------------------------------------------------
    // VALIDATE FIELDS
    // ---------------------------------------------------------
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

    // Google validation
    if (meetingType === "online") {
      if (!user?.googleAccessToken || !user?.googleRefreshToken) {
        return res.status(400).json({
          status: "error",
          message: "Connect Google Account for online meeting scheduling.",
        });
      }
    }

    let meetingObj = {};
    const isUpdate = !!meeting_id;

    // =============================================================
    // 🚀 UPDATE MEETING
    // =============================================================
    if (isUpdate) {
      const existingMeeting = record.meetings.find(
        (m) => m.meeting_id.toString() === meeting_id
      );

      if (!existingMeeting) {
        return res.status(404).json({
          status: "error",
          message: "Meeting not found.",
        });
      }

      const oldType = existingMeeting.meetingType;

      if (meetingTitle) existingMeeting.meetingTitle = meetingTitle;
      if (meetingDescription)
        existingMeeting.meetingDescription = meetingDescription;
      if (meetingStartDate) existingMeeting.meetingStartDate = meetingStartDate;
      if (meetingStartTime) existingMeeting.meetingStartTime = meetingStartTime;
      if (meetingType) existingMeeting.meetingType = meetingType;

      // 🔄 online/offline switching logic
      if (oldType === "offline" && meetingType === "online") {
        try {
          const generatedLink = await createGoogleMeetEvent(
            user,
            existingMeeting,
            timezone
          );
          if (generatedLink) existingMeeting.meetingLink = generatedLink;
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

    // =============================================================
    // 🚀 CREATE NEW MEETING
    // =============================================================
    else {
      meetingObj.meeting_id = new mongoose.Types.ObjectId();
      meetingObj.createdAt = new Date();

      if (meetingTitle) meetingObj.meetingTitle = meetingTitle;
      if (meetingDescription) meetingObj.meetingDescription = meetingDescription;
      if (meetingStartDate) meetingObj.meetingStartDate = meetingStartDate;
      if (meetingStartTime) meetingObj.meetingStartTime = meetingStartTime;
      meetingObj.meetingType = meetingType || "offline";

      if (meetingType === "offline") {
        meetingObj.meetingLocation = meetingLocation || "";
      }

      if (meetingType === "online") {
        try {
          const generatedLink = await createGoogleMeetEvent(
            user,
            meetingObj,
            timezone
          );
          if (generatedLink) meetingObj.meetingLink = generatedLink;
        } catch (err) {
          console.error("Google Meet creation failed:", err);
        }
      }

      record.meetings.push(meetingObj);
    }

    await record.save();

    const activityTitle = isUpdate
      ? record.meetings.find((m) => m.meeting_id.toString() === meeting_id)
        ?.meetingTitle
      : meetingObj.meetingTitle;

    // =============================================================
    // 🚀 ACTIVITY LOGGING
    // =============================================================
    await logActivityToContact(category, record._id, {
      action: isUpdate ? "meeting_updated" : "meeting_created",
      type: "meeting",
      title: isUpdate ? "Meeting Updated" : "Meeting Created",
      description: activityTitle || "Untitled Meeting",
    });

    return res.status(200).json({
      status: "success",
      message: isUpdate
        ? `${category} meeting updated successfully.`
        : `${category} meeting added successfully.`,
      data: record.meetings,
    });
  } catch (error) {
    console.error("Error in addOrUpdateMeeting:", error);
    return res.status(500).json({
      status: "error",
      message: "Server error",
      error: error.message,
    });
  }
};


// exports.addOrUpdateMeeting = async (req, res) => {
//   try {
//     const {
//       contact_id,
//       meeting_id,
//       meetingTitle,
//       meetingDescription,
//       meetingStartDate,
//       meetingStartTime,
//       meetingType,
//       meetingLocation,
//       timezone = "UTC", // Default timezone
//     } = req.body;

//     const user_id = req.user._id;
//     const user = await User.findById(user_id);

//     console.log(user);

//     if (!contact_id) {
//       return res.status(400).json({
//         status: "error",
//         message: "contact_id is required.",
//       });
//     }

//     const contact = await Contact.findById(contact_id);
//     if (!contact) {
//       return res.status(404).json({
//         status: "error",
//         message: "Contact not found.",
//       });
//     }

//     const meetingProvided =
//       meetingTitle ||
//       meetingDescription ||
//       meetingStartDate ||
//       meetingStartTime ||
//       meetingType;

//     if (!meetingProvided) {
//       return res.status(400).json({
//         status: "error",
//         message: "No meeting fields provided.",
//       });
//     }

//     // ✅ Validate Google Account connection for online meeting
//     if (meetingType === "online") {
//       if (!user?.googleAccessToken || !user?.googleRefreshToken) {
//         return res.status(400).json({
//           status: "error",
//           message: "Connect Google Account for online meeting scheduling.",
//         });
//       }
//     }
//     console.log(user.googleAccessToken);

//     let meetingObj = {};
//     const isUpdating = !!meeting_id;

//     // ---------- UPDATE EXISTING MEETING ----------
//     if (isUpdating) {
//       const existingMeeting = contact.meetings.find(
//         (m) => m.meeting_id.toString() === meeting_id
//       );

//       if (!existingMeeting) {
//         return res.status(404).json({
//           status: "error",
//           message: "Meeting not found for this contact.",
//         });
//       }

//       const oldType = existingMeeting.meetingType;

//       // ✅ Fill update fields
//       if (meetingTitle) existingMeeting.meetingTitle = meetingTitle;
//       if (meetingDescription)
//         existingMeeting.meetingDescription = meetingDescription;
//       if (meetingStartDate) existingMeeting.meetingStartDate = meetingStartDate;
//       if (meetingStartTime) existingMeeting.meetingStartTime = meetingStartTime;
//       if (meetingType) existingMeeting.meetingType = meetingType;

//       // ✅ Handle type changes
//       if (oldType === "offline" && meetingType === "online") {
//         try {
//           if (!existingMeeting.meetingStartDate) {
//             console.error("Start Date missing during offline → online change");
//           } else {
//             const generatedLink = await createGoogleMeetEvent(
//               user,
//               existingMeeting,
//               timezone
//             );
//             if (generatedLink) existingMeeting.meetingLink = generatedLink;
//           }
//         } catch (err) {
//           console.error("Google Meet creation failed:", err);
//         }
//         existingMeeting.meetingLocation = undefined;
//       }

//       if (oldType === "online" && meetingType === "offline") {
//         existingMeeting.meetingLink = undefined;
//         existingMeeting.meetingLocation = meetingLocation || "";
//       }

//       if (oldType === "online" && meetingType === "online") {
//         delete existingMeeting.meetingLocation;
//       }

//       if (oldType === "offline" && meetingType === "offline") {
//         existingMeeting.meetingLocation = meetingLocation || "";
//         delete existingMeeting.meetingLink;
//       }

//       existingMeeting.updatedAt = new Date();
//     }

//     // ---------- CREATE NEW MEETING ----------
//     else {
//       meetingObj.meeting_id = new mongoose.Types.ObjectId();
//       meetingObj.createdAt = new Date();

//       if (meetingTitle) meetingObj.meetingTitle = meetingTitle;
//       if (meetingDescription)
//         meetingObj.meetingDescription = meetingDescription;
//       if (meetingStartDate) meetingObj.meetingStartDate = meetingStartDate;
//       if (meetingStartTime) meetingObj.meetingStartTime = meetingStartTime;
//       meetingObj.meetingType = meetingType || "offline";

//       if (meetingType === "offline" && meetingLocation) {
//         meetingObj.meetingLocation = meetingLocation;
//       }

//       if (meetingType === "online") {
//         try {
//           if (!meetingObj.meetingStartDate) {
//             console.error(
//               "Meeting Start Date missing for new online meeting creation!"
//             );
//           } else {
//             const generatedLink = await createGoogleMeetEvent(
//               user,
//               meetingObj,
//               timezone
//             );
//             if (generatedLink) {
//               meetingObj.meetingLink = generatedLink;
//             }
//           }
//         } catch (error) {
//           console.error("Failed to create Google Meet link:", error);
//         }
//       }

//       contact.meetings.push(meetingObj);
//     }

//     await contact.save();

//     // Get the meeting title for activity logging
//     const activityMeetingTitle = isUpdating
//       ? contact.meetings.find((m) => m.meeting_id.toString() === meeting_id)
//           ?.meetingTitle
//       : meetingObj.meetingTitle;

//     // Log activity
//     if (isUpdating) {
//       await logActivityToContact(contact._id, {
//         action: "meeting_updated",
//         type: "meeting",
//         title: "Meeting Updated",
//         description: activityMeetingTitle || "Untitled Meeting",
//       });
//     } else {
//       await logActivityToContact(contact._id, {
//         action: "meeting_created",
//         type: "meeting",
//         title: "Meeting Created",
//         description: activityMeetingTitle || "Untitled Meeting",
//       });
//     }

//     return res.status(200).json({
//       status: "success",
//       message: isUpdating
//         ? "Meeting updated successfully."
//         : "Meeting added successfully.",
//       data: contact.meetings,
//     });
//   } catch (error) {
//     console.error("Error in addOrUpdateMeeting:", error);
//     return res.status(500).json({
//       status: "error",
//       message: "Server error. Please try again.",
//       error: error.message,
//     });
//   }
// };

exports.deleteMeeting = async (req, res) => {
  const { contact_id, meeting_id, category } = req.body;

  if (!mongoose.Types.ObjectId.isValid(contact_id)) {
    return res.status(400).json({
      status: "error",
      message: "Invalid contact ID",
    });
  }

  if (!category) {
    return res.status(400).json({
      status: "error",
      message: "category is required: contact or lead",
    });
  }
  var Model;
  if (category === "lead") {
    Model = Lead;
  } else {
    Model = Contact;
  }

  try {
    // 1️⃣ Find the contact first (to get the meeting title)
    const contact = await Model.findOne({
      _id: contact_id,
      createdBy: req.user._id,
      "meetings.meeting_id": meeting_id,
    });

    console.log(contact);


    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Meeting not found in this contact or unauthorized access",
      });
    }

    // 2️⃣ Get the meeting title
    const meeting = contact.meetings.find((m) => m.meeting_id === meeting_id);
    const meetingTitle = meeting ? meeting.meetingTitle : "Untitled Meeting";

    // 3️⃣ Delete the meeting
    await Model.updateOne(
      { _id: contact_id },
      { $pull: { meetings: { meeting_id } } }
    );

    // 4️⃣ Log meeting deletion activity with title instead of ID
    await logActivityToContact(category, contact_id, {
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
