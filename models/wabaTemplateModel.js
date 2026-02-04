const mongoose = require("mongoose");

// const componentSchema = new mongoose.Schema({
//   type: { type: String, required: true },
//   text: { type: String },
//   example: {
//     body_text_named_params: [
//       {
//         param_name: String,
//         example: String,
//       },
//     ],
//   },
// });

const componentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["HEADER", "BODY", "FOOTER", "BUTTONS"],
      required: true,
    },

    // HEADER
    format: {
      type: String, // TEXT | IMAGE | VIDEO | DOCUMENT
    },

    text: String, // header text / body text / footer text

    example: mongoose.Schema.Types.Mixed,

    // For media headers
    media: {
      metaHandle: String,   // Meta header_handle
      s3Url: String,        // Your S3 URL
      mimeType: String,
      fileName: String,
    },

    // BUTTONS
    buttons: [
      {
        type: {
          type: String, // QUICK_REPLY | URL | PHONE_NUMBER
        },
        text: String,
        url: String,
        phone_number: String,
      },
    ],
  },
  { _id: false }
);


const wabaTemplateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    wabaId: { type: String, required: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    language: { type: String, default: "en_US" },
    parameter_format: { type: String, default: "named" },
    components: [componentSchema],
    metaTemplateId: { type: String }, // Meta template ID
    status: { type: String, default: "pending" }, // pending, approved, rejected
  },
  { timestamps: true }
);

module.exports = mongoose.model("WabaTemplate", wabaTemplateSchema);
