const mongoose = require("mongoose");
const Contact = require("../models/contactModel"); // adjust path if needed
const { logActivityToContact } = require("../utils/activityLogger");
const Lead = require("../models/leadModel");

const getMessageSummary = (msg) => {
  if (!msg) return "";
  const words = msg.trim().split(/\s+/);
  const summary = words.slice(0, 4).join(" ");
  return summary + (words.length > 4 ? "..." : "");
};

const logMessageActivity = async (req, res) => {
  try {
    const { contact_id, whatsappMessage, emailMessage, call, category } =
      req.body;
    if (!contact_id || !mongoose.Types.ObjectId.isValid(contact_id)) {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid contact_id" });
    }
    const Model = category === "lead" ? Lead : Contact;
    const contact = await Model.findOne({
      _id: contact_id,
      createdBy: req.user._id,
    });
    if (!contact) {
      return res
        .status(404)
        .json({ status: "error", message: "Contact not found" });
    }

    if (!whatsappMessage && !emailMessage && !call) {
      return res
        .status(400)
        .json({ status: "error", message: "No message provided" });
    }

    // Log WhatsApp message activity
    if (whatsappMessage) {
      const summary = getMessageSummary(whatsappMessage);
      await logActivityToContact(category, contact_id, {
        action: "whatsapp_message_sent",
        type: "whatsapp",
        title: "WhatsApp Message Sent",
        description: `${summary}`,
      });
    }

    // Log Email message activity
    if (emailMessage) {
      const summary = getMessageSummary(emailMessage);
      await logActivityToContact(category, contact_id, {
        action: "email_message_sent",
        type: "email",
        title: "Email Sent",
        description: `${summary}`,
      });
    }
    if (call) {
      // const summary = getMessageSummary(call);
      await logActivityToContact(category, contact_id, {
        action: "call_made",
        type: "call",
        title: "Call Made",
        description: `${call}`,
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Message activities logged successfully",
    });
  } catch (error) {
    console.error("Error in logMessageActivity:", error);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error" });
  }
};

module.exports = { logMessageActivity };
