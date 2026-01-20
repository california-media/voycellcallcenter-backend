// const mongoose = require("mongoose");

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

// const templateSchema = new mongoose.Schema(
//   {
//     user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
//     wabaId: { type: String, required: true },
//     name: { type: String, required: true },
//     category: { type: String, required: true },
//     language: { type: String, default: "en_US" },
//     parameter_format: { type: String, default: "named" },
//     components: [componentSchema],
//     metaTemplateId: { type: String }, // Template ID returned from Meta
//     status: { type: String }, // e.g., "pending", "approved", "rejected"
//   },
//   { timestamps: true }
// );

// module.exports = mongoose.model("Template", templateSchema);

const mongoose = require("mongoose");

const componentSchema = new mongoose.Schema({
  type: { type: String, required: true },
  text: { type: String },
  example: {
    body_text_named_params: [
      {
        param_name: String,
        example: String,
      },
    ],
  },
});

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
