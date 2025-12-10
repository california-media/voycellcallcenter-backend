const mongoose = require("mongoose");
const User = require("../models/userModel");

const addEditTemplate = async (req, res) => {
  try {
    const userId = req.user._id;

    const {
      templateType, // ✅ "whatsapp" or "email"

      // ✅ Common ID for edit
      template_id,

      // ✅ WhatsApp Fields
      whatsappTemplateTitle,
      whatsappTemplateMessage,
      whatsappTemplateIsFavourite,

      // ✅ Email Fields
      emailTemplateTitle,
      emailTemplateSubject,
      emailTemplateBody,
      emailTemplateIsFavourite,
    } = req.body;

    // ✅ VALIDATION
    if (!templateType || !["whatsapp", "email"].includes(templateType)) {
      return res.status(400).json({
        status: "error",
        message: "templateType must be 'whatsapp' or 'email'",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    let updatedTemplate;

    // ============================================================
    // ✅ WHATSAPP TEMPLATE ADD / EDIT
    // ============================================================
    if (templateType === "whatsapp") {
      // ================= EDIT =================
      if (template_id) {
        const index = user.whatsappTemplates.findIndex(
          (tpl) => tpl.whatsappTemplate_id.toString() === template_id.toString()
        );

        if (index === -1) {
          return res.status(404).json({
            status: "error",
            message: "WhatsApp template not found",
          });
        }

        if (whatsappTemplateTitle)
          user.whatsappTemplates[index].whatsappTemplateTitle =
            whatsappTemplateTitle;

        if (whatsappTemplateMessage)
          user.whatsappTemplates[index].whatsappTemplateMessage =
            whatsappTemplateMessage;

        if (typeof whatsappTemplateIsFavourite !== "undefined") {
          user.whatsappTemplates[index].whatsappTemplateIsFavourite =
            whatsappTemplateIsFavourite;
        }

        updatedTemplate = user.whatsappTemplates[index];
      }

      // ================= ADD =================
      else {
        if (!whatsappTemplateTitle || !whatsappTemplateMessage) {
          return res.status(400).json({
            status: "error",
            message: "Title & Message are required for WhatsApp template",
          });
        }

        const newWhatsappTemplate = {
          whatsappTemplate_id: new mongoose.Types.ObjectId(),
          whatsappTemplateTitle,
          whatsappTemplateMessage,
          whatsappTemplateIsFavourite: !!whatsappTemplateIsFavourite,
        };

        user.whatsappTemplates.unshift(newWhatsappTemplate);
        updatedTemplate = newWhatsappTemplate;
      }
    }

    // ============================================================
    // ✅ EMAIL TEMPLATE ADD / EDIT
    // ============================================================
    if (templateType === "email") {
      // ================= EDIT =================
      if (template_id) {
        const index = user.emailTemplates.findIndex(
          (tpl) => tpl.emailTemplate_id.toString() === template_id.toString()
        );

        if (index === -1) {
          return res.status(404).json({
            status: "error",
            message: "Email template not found",
          });
        }

        if (emailTemplateTitle)
          user.emailTemplates[index].emailTemplateTitle = emailTemplateTitle;

        if (emailTemplateSubject)
          user.emailTemplates[index].emailTemplateSubject =
            emailTemplateSubject;

        if (emailTemplateBody)
          user.emailTemplates[index].emailTemplateBody = emailTemplateBody;

        if (typeof emailTemplateIsFavourite !== "undefined") {
          user.emailTemplates[index].emailTemplateIsFavourite =
            emailTemplateIsFavourite;
        }

        updatedTemplate = user.emailTemplates[index];
      }

      // ================= ADD =================
      else {
        if (
          !emailTemplateTitle ||
          !emailTemplateSubject ||
          !emailTemplateBody
        ) {
          return res.status(400).json({
            status: "error",
            message: "Title, Subject & Body are required for Email template",
          });
        }

        const newEmailTemplate = {
          emailTemplate_id: new mongoose.Types.ObjectId(),
          emailTemplateTitle,
          emailTemplateSubject,
          emailTemplateBody,
          emailTemplateIsFavourite: !!emailTemplateIsFavourite,
        };

        user.emailTemplates.unshift(newEmailTemplate);
        updatedTemplate = newEmailTemplate;
      }
    }

    // ✅ SAVE USER
    await user.save();

    // ✅ FINAL RESPONSE
    return res.status(200).json({
      status: "success",
      message: template_id
        ? "Template Updated Successfully"
        : "Template Added Successfully",
      templateType,
      data: updatedTemplate,
    });
  } catch (error) {
    console.error("Add/Edit Template Error:", error);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
};

module.exports = { addEditTemplate };
