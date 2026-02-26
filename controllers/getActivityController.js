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
    const userId = req.user._id;
    const contact = await Contact.findById(contact_id);

    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Contact not found",
      });
    }

    // Permission Check
    const isCreator = String(contact.createdBy) === String(userId);
    const assignedArray = Array.isArray(contact.assignedTo) ? contact.assignedTo.map(id => String(id)) : [];
    const isAssignee = assignedArray.includes(String(userId));
    const isAdminOfCreator = async () => {
      const creator = await mongoose.model("User").findById(contact.createdBy).select("createdByWhichCompanyAdmin role");
      return creator && (String(creator._id) === String(userId) || String(creator.createdByWhichCompanyAdmin) === String(userId));
    };

    if (req.user.role === "user" && !isCreator && !isAssignee) {
      return res.status(403).json({ status: "error", message: "Unauthorized access to these activities." });
    }

    if (req.user.role === "companyAdmin" && !(await isAdminOfCreator())) {
      return res.status(403).json({ status: "error", message: "Unauthorized: Record belongs to another company." });
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
