const mongoose = require("mongoose");

// A node in the visual flow builder
const nodeSchema = new mongoose.Schema({
  id:       { type: String, required: true },
  type:     {
    type: String,
    enum: [
      "trigger",
      "text", "media", "interactiveButtons", "interactiveList",
      "delay",
      "addToGroup", "removeFromGroup", "updateContact",
      "sendEmail", "webhook",
    ],
    required: true,
  },
  position: {
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
  },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  // data shape examples:
  // trigger: { triggerType: "keyword|newContact|campaignReply|manual", keyword: "", matchCriteria: "exact|contains" }
  // text: { message: "" }
  // media: { mediaType: "image|video|audio|document", url: "", caption: "" }
  // interactiveButtons: { body: "", buttons: [{ id, label }] }
  // interactiveList: { body: "", sections: [{ title, items: [{ id, title, description }] }] }
  // delay: { duration: 5, unit: "minutes|hours|days" }
  // addToGroup / removeFromGroup: { tagId: "", tagName: "" }
  // updateContact: { field: "status|notes|group|meeting|call|...", value: "" }
  // sendEmail: { subject: "", body: "" }
  // webhook: { url: "", method: "POST|GET", headers: {}, body: "" }
}, { _id: false });

// An edge connecting two nodes (supports branching via sourceHandle)
const edgeSchema = new mongoose.Schema({
  id:           { type: String, required: true },
  source:       { type: String, required: true },
  target:       { type: String, required: true },
  sourceHandle: { type: String, default: null }, // button id for branching
  label:        { type: String },
}, { _id: false });

const WabaFlowSchema = new mongoose.Schema({
  companyAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name:         { type: String, required: true },
  description:  { type: String },
  nodes:        { type: [nodeSchema], default: [] },
  edges:        { type: [edgeSchema], default: [] },
  isActive:     { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("WabaFlow", WabaFlowSchema);
