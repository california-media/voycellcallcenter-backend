const axios = require("axios");
const { META_GRAPH_URL } = require("../config/whatsapp");
const User = require("../models/userModel");
const WabaTemplate = require("../models/wabaTemplateModel");
const { META_APP_ID } = process.env;

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
  businessAccountId
) => {
  try {
    console.log("===== Upload Media to FB Start =====");
    console.log("File name:", fileName);
    console.log("Format:", format);
    console.log("File size:", fileBuffer.length, "bytes");

    const mimeType = getMimeType(format, fileName);

    const startUrl = `${META_GRAPH_URL}/${META_APP_ID}/uploads`;

    console.log("Starting upload session:", startUrl);

    const startResponse = await axios.post(startUrl, null, {
      params: {
        file_name: fileName,
        file_length: fileBuffer.length,
        file_type: mimeType,
        access_token: accessToken,
      },
    });

    console.log("Upload session response:", startResponse.data);

    if (!startResponse.data?.id) {
      throw new Error("Failed to start upload session");
    }

    const rawSessionId = startResponse.data.id;
    const sessionId = rawSessionId.replace(/^upload:/, "");

    console.log("Raw session ID:", rawSessionId);
    console.log("Clean session ID:", sessionId);


    const uploadUrl = `${META_GRAPH_URL}/upload:${sessionId}`;

    console.log("Uploading file bytes to:", uploadUrl);

    const uploadResponse = await axios.post(uploadUrl, fileBuffer, {
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: "0",
        "Content-Type": "application/octet-stream",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    console.log("Upload file response:", uploadResponse.data);

    if (!uploadResponse.data?.h) {
      throw new Error("Failed to upload file bytes");
    }

    const uploadedFileHandle = uploadResponse.data.h;

    console.log("===== Upload Media to FB End =====");
    console.log("Uploaded file handle:", uploadedFileHandle);

    return uploadedFileHandle;
  } catch (err) {
    console.error("===== Upload Media to FB Error =====");
    console.error("Error uploading media:", err.message);
    console.error(err.response?.data || err);
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
    console.log("===== Create Template Request Start =====");
    console.log("Request body:", req.body);
    console.log("Uploaded file:", req.file);

    const userId = req.user?._id;
    if (!userId) {
      console.error("Unauthorized: No user ID found in request");
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user?.whatsappWaba) {
      console.error("WABA not connected for user:", userId);
      return res.status(400).json({ message: "WABA not connected" });
    }

    const { wabaId, accessToken, businessAccountId } = user.whatsappWaba;
    console.log("WABA credentials:", { wabaId, businessAccountId });

    if (!wabaId || !accessToken) {
      console.error("Missing WABA credentials");
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
          console.error("Invalid components JSON:", err.message);
          return res.status(400).json({ message: "Invalid components JSON" });
        }
      } else if (Array.isArray(componentsFromBody)) {
        components = componentsFromBody;
      } else {
        console.error("Components not an array:", componentsFromBody);
        return res.status(400).json({ message: "Components must be an array" });
      }
    }
    console.log("Parsed components:", components);

    if (!name || !category || !components?.length) {
      console.error("Missing required fields: name, category, or components");
      return res.status(400).json({
        message: "name, category and components are required",
      });
    }

    const headerComponent = components.find((c) => c.type === "HEADER");
    const bodyComponents = components.filter((c) => c.type === "BODY");
    const footerComponent = components.find((c) => c.type === "FOOTER");
    const buttonsComponent = components.find((c) => c.type === "BUTTONS");
    // const processedBody = bodyComponents.map((c, index) => {
    //   if (!c.example) {
    //     const matches = [...c.text.matchAll(/{{(\w+)}}/g)];

    //     if (matches.length > 0) {
    //       c.example = {
    //         body_text_named_params: matches.map((m) => ({
    //           param_name: m[1],
    //           example: "Test",
    //         })),
    //       };
    //     }
    //   }

    //   console.log(`BODY component[${index}] processed:`, c);
    //   return c;
    // });

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

      console.log(`BODY component[${index}] processed:`, c);
      return c;
    });


    // 2️⃣ Process HEADER if provided
    let processedHeader = [];
    if (headerComponent) {
      console.log("Processing HEADER component:", headerComponent);

      const validHeaderFormats = ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"];
      const format = validHeaderFormats.includes(
        headerComponent.format?.toUpperCase()
      )
        ? headerComponent.format.toUpperCase()
        : "TEXT";

      let headerObj = { type: "HEADER", format };

      // if (format === "TEXT") {
      //   headerObj.text = headerComponent.text || "";

      //   // Check for variables in text header
      //   const matches = [
      //     ...(headerComponent.text || "").matchAll(/{{(\w+)}}/g),
      //   ];
      //   if (matches.length > 0) {
      //     headerObj.example = {
      //       header_text: [matches[0][1]], // First variable example
      //     };
      //   }
      // } 
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
      } else {
        // Media header - check if file was uploaded
        if (!req.file) {
          console.error(
            `Header format ${format} requires a media file to be uploaded`
          );
          return res.status(400).json({
            message: `Header format ${format} requires a media file. Please upload an image, video, or document.`,
          });
        }

        console.log(`Uploading HEADER media to FB: format=${format}`);
        console.log("File details:", {
          fieldname: req.file.fieldname,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
        });

        // Upload file buffer to Facebook
        const mediaHandle = await uploadMediaToFB(
          accessToken,
          wabaId,
          req.file.buffer,
          req.file.originalname,
          format,
          businessAccountId
        );
        console.log("Media uploaded, received handle:", mediaHandle);

        if (!mediaHandle) {
          console.error("Failed to get media handle from FB");
          return res
            .status(500)
            .json({ message: "Failed to upload header media to FB" });
        }

        headerObj.example = {
          header_handle: [mediaHandle],
        };
      }

      processedHeader = [headerObj];
      console.log("Processed HEADER:", processedHeader);
    }

    // 3️⃣ Process FOOTER if provided
    let processedFooter = [];
    if (footerComponent?.text) {
      processedFooter = [{ type: "FOOTER", text: footerComponent.text }];
      console.log("Processed FOOTER:", processedFooter);
    }

    // 4️⃣ Process BUTTONS if provided
    let processedButtons = [];
    if (buttonsComponent?.buttons) {
      processedButtons = [buttonsComponent];
      console.log("Processed BUTTONS:", processedButtons);
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
    console.log(
      "Final payload ready for Meta API:",
      JSON.stringify(payload, null, 2)
    );


    const url = `${META_GRAPH_URL}/${wabaId}/message_templates`;
    console.log("Sending request to:", url);

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

    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    console.log("Meta API response:", response.data);


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
    console.log("Template saved in DB:", newWabaTemplate._id);

    console.log("===== Create Template Request End =====");
    return res.status(201).json({
      success: true,
      message: "Template submitted to Meta and saved as WabaTemplate",
      data: newWabaTemplate,
    });
  } catch (error) {
    const metaError = error.response?.data?.error;
    console.error("===== Create Template Error =====");
    console.error("Error message:", metaError?.message || error.message);
    console.error("Full Meta error object:", metaError);
    console.error("Stack trace:", error.stack);

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

exports.getWabaTemplates = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

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
      const updated = await WabaTemplate.findOneAndUpdate(
        { metaTemplateId: t.id },
        {
          user: userId,
          wabaId,
          name: t.name,
          category: t.category,
          language: t.language,
          components: t.components,
          status: t.status,
          syncedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      syncedTemplates.push(updated);
    }

    return res.status(200).json({
      success: true,
      message: "Fetched and synced WABA templates",
      data: syncedTemplates,
    });
  } catch (error) {
    console.error("Get WABA Templates Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch WABA templates",
      error: error.message,
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
