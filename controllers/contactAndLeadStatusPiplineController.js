const Lead = require("../models/leadModel");
const Contact = require("../models/contactModel");
const Pipeline = require("../models/Pipeline");
const User = require("../models/userModel");
const { logActivityToContact } = require("../utils/activityLogger");


exports.changeStatus = async (req, res) => {
  try {
    const { contact_id, newStatus, note, category } = req.body;
    const userId = req.user?._id;

    if (!newStatus) {
      return res.status(400).json({ message: "Status is required" });
    }

    // Check models
    let contact = await Contact.findById(contact_id);
    let lead = await Lead.findOne({ contact_id });

    // Status before update
    const oldStatus = lead?.status || contact?.status;

    /*
    =========================================================
      CASE 1️⃣: Contact exists (not converted yet)
      = Convert ONLY when status === "interested"
    =========================================================
    */
    if (contact && !lead) {
      // If status is NOT interested → normal status update inside contact model
      if (newStatus !== "interested") {
        contact.status = newStatus;
        await contact.save();

        return res.status(200).json({
          message: "Contact status updated",
          status: "success",
          data: contact,
        });
      }

      // If status = interested → convert to lead
      lead = await Lead.create({
        _id: contact._id, // keep same ID
        contact_id: contact._id, // keep same ID
        firstname: contact.firstname,
        lastname: contact.lastname,
        company: contact.company,
        designation: contact.designation,
        emailAddresses: contact.emailAddresses,
        notes: contact.notes,
        website: contact.website,
        phoneNumbers: contact.phoneNumbers,
        status: "interested",
        isLead: true,
        contactImageURL: contact.contactImageURL,
        isFavourite: contact.isFavourite,
        tags: contact.tags,
        linkedin: contact.linkedin,
        instagram: contact.instagram,
        telegram: contact.telegram,
        twitter: contact.twitter,
        facebook: contact.facebook,
        tasks: contact.tasks,
        meetings: contact.meetings,
        attachments: contact.attachments,
        activities: contact.activities,
        assignedTo: contact.assignedTo,
        createdBy: contact.createdBy,
      });

      // Remove contact completely
      await Contact.findByIdAndDelete(contact_id);
      // Create first pipeline
      await Pipeline.create({
        lead_id: contact_id,
        previousStatus: oldStatus,
        currentStatus: "interested",
        changedBy: userId,
        note,
      });
      await logActivityToContact("lead", lead.contact_id, {
        action: `lead_status_changed`,
        type: "lead",
        title: "Status Updated",
        description: `Status updated to ${newStatus}`,
      });

      return res.status(200).json({
        message: "Contact converted to Lead successfully",
        status: "success",
        data: lead,
      });
    }

    /*
    =========================================================
      CASE 2️⃣: Lead exists already (contact removed earlier)
      = Only update Lead model
    =========================================================
    */
    if (lead) {
      lead.status = newStatus;
      await lead.save();

      // create pipeline for next stage
      await Pipeline.create({
        lead_id: contact_id,
        previousStatus: oldStatus,
        currentStatus: newStatus,
        changedBy: userId,
        note,
      });
      await logActivityToContact("lead", lead._id, {
        action: `lead_status_changed`,
        type: "lead",
        title: "Status Updated",
        description: `Status updated to ${newStatus}`,
      });
      return res.status(200).json({
        message: "Lead status updated successfully",
        status: "success",
        data: lead,
      });
    }

    /*
    =========================================================
      CASE 3️⃣: Neither contact nor lead exists
    =========================================================
    */
    return res.status(404).json({
      message: "Record not found",
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error", error });
  }
};

// 🟣 2️⃣ Get pipeline for a specific lead
exports.getPipeline = async (req, res) => {
  try {
    const { lead_id } = req.body;

    const pipeline = await Pipeline.find({ lead_id: lead_id })
      .populate("changedBy", "firstname lastname email")
      .sort({ createdAt: 1 });

    res.status(200).json({
      message: "Lead pipeline fetched successfully",
      status: "success",
      data: pipeline,
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error", error });
  }
};

// 🟡 3️⃣ Get all leads grouped by current pipeline status
exports.getPipelineOverview = async (req, res) => {
  try {
    const leads = await Contact.aggregate([
      { $match: { isLead: true } },
      {
        $group: {
          _id: "$status",
          total: { $sum: 1 },
          leads: {
            $push: {
              _id: "$_id",
              firstname: "$firstname",
              lastname: "$lastname",
              email: "$emailAddresses",
              company: "$company",
              status: "$status",
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({
      message: "Pipeline overview fetched successfully",
      status: "success",
      data: leads,
    });
  } catch (error) {
    res.status(500).json({ message: "Internal server error", error });
  }
};
