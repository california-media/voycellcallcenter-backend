const mongoose = require("mongoose");
const User = require("../models/userModel");

const deleteTemplate = async (req, res) => {
  try {
    const userId = req.user._id;
    const { templateType, template_id } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    let templateFound = false;

    if (templateType === "whatsappTemplate") {
      const initialLength = user.whatsappTemplates.length;
      user.whatsappTemplates = user.whatsappTemplates.filter(
        (tpl) => tpl.whatsappTemplate_id.toString() !== template_id
      );
      templateFound = user.whatsappTemplates.length !== initialLength;
    } else if (templateType === "emailTemplate") {
      const initialLength = user.emailTemplates.length;
      user.emailTemplates = user.emailTemplates.filter(
        (tpl) => tpl.emailTemplate_id.toString() !== template_id
      );
      templateFound = user.emailTemplates.length !== initialLength;
    } else {
      return res
        .status(400)
        .json({ status: "error", message: "Invalid templateType" });
    }

    if (!templateFound) {
      return res
        .status(404)
        .json({ status: "error", message: `${templateType} not found` });
    }

    await user.save();

    let templateTypeMessage;

    if (templateType === "whatsappTemplate") {
      templateTypeMessage = "WhatsApp Template";
    } else if (templateType === "emailTemplate") {
      templateTypeMessage = "Email Template";
    }

    return res.status(200).json({
      status: "success",
      message: `${templateTypeMessage} Deleted`,
      data: {
        templateType,
        template_id,
      },
    });
  } catch (error) {
    console.error("Delete Template Error:", error);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
};

module.exports = {
  deleteTemplate,
};
