const Contact = require("../models/contactModel");
const mongoose = require("mongoose");

const getContactActivities = async (req, res) => {
  const { contact_id } = req.body;

  if (!contact_id || !mongoose.Types.ObjectId.isValid(contact_id)) {
    return res.status(400).json({
      status: "error",
      message: "Invalid or missing contact_id",
    });
  }

  try {
    const contact = await Contact.findById(contact_id).select("activities");

    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Contact not found",
      });
    }

    // Sort activities by timestamp descending (latest first)
    const sortedActivities = (contact.activities || []).sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    return res.status(200).json({
      status: "success",
      data: sortedActivities,
    });
  } catch (error) {
    console.error("Error fetching contact activities:", error);
    return res.status(500).json({
      status: "error",
      message: "Server error while fetching activities",
    });
  }
};

module.exports = { getContactActivities };
