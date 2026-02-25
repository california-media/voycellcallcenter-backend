const axios = require("axios");
const { META_GRAPH_URL } = require("../config/whatsapp");
const User = require("../models/userModel");
const WabaTemplate = require("../models/wabaTemplateModel");
const { uploadWhatsAppMediaTemplateToS3 } = require("../utils/uploadWhatsAppMedia");
const { downloadMetaMedia } = require("../services/metaMedia");
const FormData = require("form-data");
const { META_APP_ID } = process.env;
const mongoose = require("mongoose");

//test template payload
// {
//     "name": "order_conformation_c6",
//     "language": "en_US",
//     "category": "utility", //UTILITY
//     "parameter_format": "named",
//     "components": [
//         {
//             "type": "HEADER",
//             "format": "TEXT",
//             "text": "Order Confirmation"
//         },
//         {
//             "type": "BODY",
//             "text": "Thank you, {{first_name}}! Your order number is {{order_number}}. Please keep it for reference.",
//             "example": {
//                 "body_text_named_params": [
//                     {
//                         "param_name": "first_name",
//                         "example": "Pablo"
//                     },
//                     {
//                         "param_name": "order_number",
//                         "example": "860198-230332"
//                     }
//                 ]
//             }
//         },
//         {
//             "type": "FOOTER",
//             "text": "contact support for any query."
//         }
//     ]
// }

const getMimeType = (format, fileName) => {
  const ext = fileName.split(".").pop().toLowerCase();

  const mimeTypes = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    // Videos
    mp4: "video/mp4",
    "3gp": "video/3gpp",
    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  return mimeTypes[ext] || "application/octet-stream";
};

const uploadMediaToFB = async (
  accessToken,
  wabaId,
  fileBuffer,
  fileName,
  format,
  businessAccountId,
  phoneNumberId
) => {
  try {
    const mimeType = getMimeType(format, fileName);

    const startUrl = `${META_GRAPH_URL}/${META_APP_ID}/uploads`;
    const startResponse = await axios.post(startUrl, null, {
      params: {
        file_name: fileName,
        file_length: fileBuffer.length,
        file_type: mimeType,
        access_token: accessToken,
      }
    });

    if (!startResponse.data?.id) {
      throw new Error("Failed to start upload session");
    }

    const rawSessionId = startResponse.data.id;
    const sessionId = rawSessionId.replace(/^upload:/, "");

    const uploadUrl = `${META_GRAPH_URL}/upload:${sessionId}`;

    const uploadResponse = await axios.post(uploadUrl, fileBuffer, {
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: "0",
        "Content-Type": "application/octet-stream",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (!uploadResponse.data?.h) {
      throw new Error("Failed to upload file bytes");
    }

    const uploadedFileHandle = uploadResponse.data.h;

    return uploadedFileHandle;
  } catch (err) {
    throw err;
  }
};

const generateExampleForParam = (paramName) => {
  const key = paramName.toLowerCase();

  if (key.includes("name")) return "John";
  if (key.includes("order")) return "ORD-12345";
  if (key.includes("amount")) return "499";
  if (key.includes("price")) return "499";
  if (key.includes("date")) return "12 Jan 2026";
  if (key.includes("time")) return "10:30 AM";
  if (key.includes("otp")) return "123456";
  if (key.includes("code")) return "ABC123";
  if (key.includes("email")) return "john@example.com";
  if (key.includes("phone")) return "9876543210";
  if (key.includes("ticket")) return "TCK-8899";

  return "Sample";
};

exports.createTemplate = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user?.whatsappWaba) {
      return res.status(400).json({ message: "WABA not connected" });
    }

    const { wabaId, accessToken, businessAccountId, phoneNumberId } = user.whatsappWaba;

    if (!wabaId || !accessToken) {
      return res.status(400).json({ message: "Missing WABA credentials" });
    }

    const {
      name,
      category,
      language = "en_US",
      components: componentsFromBody,
      header_format,
    } = req.body;

    let components = [];
    if (componentsFromBody) {
      if (typeof componentsFromBody === "string") {
        try {
          components = JSON.parse(componentsFromBody);
        } catch (err) {
          return res.status(400).json({ message: "Invalid components JSON" });
        }
      } else if (Array.isArray(componentsFromBody)) {
        components = componentsFromBody;
      } else {
        return res.status(400).json({ message: "Components must be an array" });
      }
    }

    if (!name || !category || !components?.length) {
      return res.status(400).json({
        message: "name, category and components are required",
      });
    }

    const headerComponent = components.find((c) => c.type === "HEADER");
    const bodyComponents = components.filter((c) => c.type === "BODY");
    const footerComponent = components.find((c) => c.type === "FOOTER");
    const buttonsComponent = components.find((c) => c.type === "BUTTONS");

    const processedBody = bodyComponents.map((c, index) => {
      const text = c.text || "";
      const matches = [...text.matchAll(/{{(\w+)}}/g)];

      if (matches.length > 0) {
        c.example = {
          body_text_named_params: matches.map((m) => ({
            param_name: m[1],
            example: generateExampleForParam(m[1]),
          })),
        };
      }

      return c;
    });


    // 2️⃣ Process HEADER if provided
    let processedHeader = [];
    if (headerComponent) {

      const validHeaderFormats = ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"];
      const format = validHeaderFormats.includes(
        headerComponent.format?.toUpperCase()
      )
        ? headerComponent.format.toUpperCase()
        : "TEXT";

      let headerObj = { type: "HEADER", format };

      if (format === "TEXT") {
        headerObj.text = headerComponent.text || "";

        const matches = [
          ...(headerComponent.text || "").matchAll(/{{(\w+)}}/g),
        ];

        if (matches.length > 0) {
          headerObj.example = {
            header_text: matches.map((m) =>
              generateExampleForParam(m[1])
            ),
          };
        }
      } else if (format === "IMAGE" || format === "VIDEO" || format === "DOCUMENT") {
        // Media header - check if file was uploaded
        if (!req.file) {
          return res.status(400).json({
            message: `Header format ${format} requires a media file. Please upload an image, video, or document.`,
          });
        }

        const mediaHandle = await uploadMediaToFB(
          accessToken,
          wabaId,
          req.file.buffer,
          req.file.originalname,
          format, // IMAGE | VIDEO | DOCUMENT
          businessAccountId,
          phoneNumberId
        );

        const s3Url = await uploadWhatsAppMediaTemplateToS3({
          userId,
          messageType: format.toLowerCase(), // image | video | document
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          originalName: req.file.originalname,
        });

        headerObj.example = {
          header_handle: [mediaHandle],
        };

        headerObj.media = {
          metaHandle: mediaHandle,
          s3Url,
          mimeType: req.file.mimetype,
          fileName: req.file.originalname,
        };

        if (!mediaHandle) {
          return res
            .status(500)
            .json({ message: "Failed to upload header media to FB" });
        }

        headerObj.example = {
          header_handle: [mediaHandle],
        };

        // ADD THIS BLOCK:
        if (format === "DOCUMENT") {
          // This provides a sample filename for the UI preview
          // Use the original filename or a generic one like "invoice.pdf"
          headerObj.example.header_text = [req.file.originalname || "document.pdf"];
        }

      }
      processedHeader = [headerObj];
    }

    // 3️⃣ Process FOOTER if provided
    let processedFooter = [];
    if (footerComponent?.text) {
      processedFooter = [{ type: "FOOTER", text: footerComponent.text }];
    }

    // 4️⃣ Process BUTTONS if provided
    let processedButtons = [];
    if (buttonsComponent?.buttons) {
      // processedButtons = [buttonsComponent];
      if (buttonsComponent?.buttons?.length) {
        processedButtons = [
          {
            type: "BUTTONS",
            buttons: buttonsComponent.buttons.map((btn) => ({
              type: btn.type,
              text: btn.text,
              url: btn.url,
              phone_number: btn.phone_number,
            })),
          },
        ];
      }
    }


    const payload = {
      name: name.toLowerCase().replace(/\s+/g, "_"),
      category: category.toUpperCase(),
      language,
      components: [
        ...processedHeader,
        ...processedBody,
        ...processedFooter,
        ...processedButtons,
      ].filter(Boolean),
    };
    payload.parameter_format = "named";
    // 🔥 STRIP DB-ONLY FIELDS BEFORE SENDING TO META
    const metaComponents = payload.components.map((c) => {
      const clean = {
        type: c.type,
      };

      if (c.format) clean.format = c.format;
      if (c.text) clean.text = c.text;
      if (c.example) clean.example = c.example;
      if (c.buttons) clean.buttons = c.buttons;

      return clean;
    });

    const url = `${META_GRAPH_URL}/${wabaId}/message_templates`;
    const hasInvalidVariables = payload.components.some((c) => {
      if (!c.text) return false;
      const hasVars = c.text.includes("{{");
      return hasVars && !c.example;
    });

    if (hasInvalidVariables) {
      return res.status(400).json({
        message: "Template contains variables but examples could not be generated",
      });
    }

    const response = await axios.post(
      url,
      {
        name: payload.name,
        category: payload.category,
        language: payload.language,
        parameter_format: payload.parameter_format,
        components: metaComponents,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const newWabaTemplate = await WabaTemplate.create({
      user: userId,
      wabaId,
      name: payload.name,
      category: payload.category,
      language: payload.language,
      components: payload.components,
      metaTemplateId: response.data.id,
      status: response.data.status || "PENDING",
    });

    return res.status(201).json({
      success: true,
      message: "Template submitted to Meta and saved as WabaTemplate",
      data: newWabaTemplate,
    });
  } catch (error) {
    const metaError = error.response?.data?.error;
    return res.status(error.response?.status || 400).json({
      success: false,
      message:
        metaError?.message || error.message || "Failed to create template",
      error_code: metaError?.code,
      error_subcode: metaError?.error_subcode,
      metaError,
    });
  }
};

exports.editTemplate = async (req, res) => {
  try {
    const { templateId } = req.body;
    const userId = req.user._id;

    if (!templateId) {
      return res.status(400).json({ message: "templateId required" });
    }

    // -----------------------------------
    // Get Template + User
    // -----------------------------------
    const template = await WabaTemplate.findById(templateId);
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    const user = await User.findById(userId);
    const { wabaId, accessToken } = user.whatsappWaba;

    if (!wabaId || !accessToken) {
      return res.status(400).json({ message: "WABA credentials missing" });
    }

    // -----------------------------------
    // Parse Components
    // -----------------------------------
    let components =
      typeof req.body.components === "string"
        ? JSON.parse(req.body.components)
        : req.body.components;

    if (!components?.length) {
      return res.status(400).json({ message: "Components required" });
    }

    const processedComponents = [];

    // -----------------------------------
    // Process Components
    // -----------------------------------
    for (const comp of components) {
      // ===== HEADER =====
      if (comp.type === "HEADER") {
        const format = comp.format?.toUpperCase() || "TEXT";

        let headerObj = {
          type: "HEADER",
          format,
        };

        // TEXT HEADER
        if (format === "TEXT") {
          headerObj.text = comp.text || "";
        }

        // MEDIA HEADER
        if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) {
          if (!req.file) {
            return res.status(400).json({
              message: `${format} header requires media file`,
            });
          }

          // Upload to Meta → get handle
          const mediaHandle = await uploadMediaToFB(
            accessToken,
            wabaId,
            req.file.buffer,
            req.file.originalname,
            format
          );

          // Upload to S3
          const s3Url = await uploadWhatsAppMediaTemplateToS3({
            userId,
            messageType: format.toLowerCase(),
            buffer: req.file.buffer,
            mimeType: req.file.mimetype,
            originalName: req.file.originalname,
          });

          // Meta payload field
          headerObj.example = {
            header_handle: [mediaHandle],
          };

          // DB-only media storage
          headerObj.media = {
            metaHandle: mediaHandle,
            s3Url,
            mimeType: req.file.mimetype,
            fileName: req.file.originalname,
          };
        }

        processedComponents.push(headerObj);
      }

      // ===== BODY =====
      if (comp.type === "BODY") {
        processedComponents.push({
          type: "BODY",
          text: comp.text,
        });
      }

      // ===== FOOTER =====
      if (comp.type === "FOOTER") {
        processedComponents.push({
          type: "FOOTER",
          text: comp.text,
        });
      }

      // ===== BUTTONS =====
      if (comp.type === "BUTTONS") {
        processedComponents.push({
          type: "BUTTONS",
          buttons: comp.buttons,
        });
      }
    }

    // -----------------------------------
    // 🔥 STRIP INVALID FIELDS FOR META
    // -----------------------------------
    const metaComponents = processedComponents.map((c) => {
      const clean = { type: c.type };

      if (c.format) clean.format = c.format;
      if (c.text) clean.text = c.text;
      if (c.example) clean.example = c.example;
      if (c.buttons) clean.buttons = c.buttons;

      return clean;
    });

    // -----------------------------------
    // Try Meta Edit
    // -----------------------------------
    let metaResponse;
    const metaUrl = `https://graph.facebook.com/v23.0/${template.metaTemplateId}`;

    try {
      metaResponse = await axios.post(
        metaUrl,
        {
          category: template.category,
          language: template.language,
          components: metaComponents,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

    } catch (err) {
      // -----------------------------------
      // Recreate Template (Meta restriction)
      // -----------------------------------
      const newName = `${template.name}`;

      metaResponse = await axios.post(
        `https://graph.facebook.com/v23.0/${wabaId}/message_templates`,
        {
          name: newName,
          category: template.category,
          language: template.language,
          components: metaComponents,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      // Update metaTemplateId → new template
      template.metaTemplateId = metaResponse.data.id;
      template.name = newName;
    }

    // -----------------------------------
    // Update DB
    // -----------------------------------
    template.category = template.category;
    template.language = template.language;
    template.components = processedComponents;

    await template.save();

    res.json({
      success: true,
      message: "Template edited successfully",
      meta: metaResponse.data,
      data: template,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to edit template",
      error: error.response?.data || error.message,
    });
  }
};

function mergeComponents(metaComponents, dbComponents = []) {
  return metaComponents.map((metaComp) => {
    const oldComp = dbComponents.find(c => c.type === metaComp.type);

    // HEADER
    if (metaComp.type === "HEADER") {
      if (metaComp.format !== "TEXT" && oldComp?.media?.s3Url) {
        return {
          ...metaComp,
          media: oldComp.media, // ✅ ALWAYS keep S3
        };
      }
      return metaComp;
    }

    // BODY
    if (metaComp.type === "BODY") {
      return {
        ...metaComp,
        example: metaComp.example || oldComp?.example,
      };
    }

    // FOOTER
    if (metaComp.type === "FOOTER") {
      return metaComp;
    }

    // BUTTONS
    if (metaComp.type === "BUTTONS") {
      return metaComp;
    }

    return metaComp;
  });
}

// controllers/wabaTemplateController.js
// 📌 Get all APPROVED templates of logged-in user

exports.getWabaTemplates = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Pagination + Search params
    const page = parseInt(req.body.page) || 1;
    const limit = parseInt(req.body.limit) || 10;
    const search = req.body.search || "";
    const skip = (page - 1) * limit;


    const user = await User.findById(userId);
    if (!user?.whatsappWaba) {
      return res.status(400).json({ message: "WhatsApp WABA not connected" });
    }

    const { wabaId, accessToken } = user.whatsappWaba;
    if (!wabaId || !accessToken)
      return res.status(400).json({ message: "Missing WABA credentials" });

    // Step 1: Fetch templates from Meta API
    const url = `${META_GRAPH_URL}/${wabaId}/message_templates?limit=100`;

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const metaTemplates = response.data.data;

    const syncedTemplates = [];
    for (const t of metaTemplates) {
      const existingTemplate = await WabaTemplate.findOne({
        metaTemplateId: t.id,
      });

      let mergedComponents;

      if (existingTemplate) {
        mergedComponents = mergeComponents(
          t.components,
          existingTemplate.components
        );
      } else {
        mergedComponents = t.components;
      }

      const updated = await WabaTemplate.findOneAndUpdate(
        { metaTemplateId: t.id },
        {
          user: userId,
          wabaId,
          name: t.name,
          category: t.category,
          language: t.language,
          // components: mergedComponents, // ✅ IMPORTANT
          status: t.status,
          syncedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      syncedTemplates.push(updated);
    }

    // Build search filter
    const searchFilter = {
      user: userId,
      wabaId,
      name: { $regex: search, $options: "i" }, // case-insensitive
    };

    // Get total count
    const totalTemplates = await WabaTemplate.countDocuments(searchFilter);

    // Fetch paginated templates
    const templates = await WabaTemplate.find(searchFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      message: "Fetched and synced WABA templates",
      data: templates,
      pagination: {
        total: totalTemplates,
        page,
        limit,
        totalPages: Math.ceil(totalTemplates / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch WABA templates",
      error: error.message,
    });
  }
};

exports.getApprovedTemplates = async (req, res) => {
  try {
    const userId = req.user._id; // from auth middleware

    const templates = await WabaTemplate.find({
      user: userId,
      status: "APPROVED",
    })
      .sort({ createdAt: -1 }) // latest first
      .lean();

    return res.status(200).json({
      success: true,
      count: templates.length,
      data: templates,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch approved templates",
    });
  }
};

// controllers/wabaTemplateController.js
// 📌 Get single template by ID (only approved + owned by user)
exports.getTemplateById = async (req, res) => {
  try {
    const userId = req.user._id; // from auth middleware
    const templateId = req.body.templateId;

    if (!mongoose.Types.ObjectId.isValid(templateId)) {
      return res.status(400).json({ success: false, message: "Invalid template ID" });
    }

    const template = await WabaTemplate.findOne({
      _id: templateId,
      user: userId,
      status: "APPROVED",
    }).lean();

    if (!template) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }
    return res.status(200).json({
      success: true,
      data: template,
    });
  }
  catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch template",
    });
  }
};


exports.deleteWabaTemplate = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { name } = req.query;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user?.whatsappWaba) {
      return res.status(400).json({ message: "WhatsApp WABA not connected" });
    }

    const { wabaId, accessToken } = user.whatsappWaba;
    const template = await WabaTemplate.findOne({
      name,
      user: userId,
      wabaId,
    });

    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }
    const metaResponse = await axios.delete(
      `${META_GRAPH_URL}/${wabaId}/message_templates`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: {
          name: template.name,
        },
      }
    );

    await WabaTemplate.deleteOne({
      name: template.name,
      user: userId,
      wabaId,
    });

    return res.status(200).json({
      success: true,
      message: "Template deleted from Meta and CRM",
    });
  } catch (error) {
    const metaError = error.response?.data?.error;

    return res.status(400).json({
      success: false,
      message: metaError?.message || "Failed to delete template",
      metaError,
    });
  }
};
