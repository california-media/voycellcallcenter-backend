const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema({
  nodeId:   { type: String },
  nodeType: { type: String },
  question: { type: String },
  answer:   { type: mongoose.Schema.Types.Mixed },
  answeredAt:{ type: Date },
}, { _id: false });

const WabaFlowSubmissionSchema = new mongoose.Schema({
  flow:          { type: mongoose.Schema.Types.ObjectId, ref: "WabaFlow", required: true, index: true },
  session:       { type: mongoose.Schema.Types.ObjectId, ref: "WabaFlowSession" },
  companyAdmin:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  flowName:      { type: String },
  contactPhone:  { type: String, required: true, index: true },
  contactId:     { type: mongoose.Schema.Types.ObjectId },   // Contact or Lead _id if found
  contactType:   { type: String, enum: ["contact", "lead", "unknown"] },
  answers:       { type: [answerSchema], default: [] },
  status:        { type: String, enum: ["completed", "timeout"], default: "completed" },
  completedAt:   { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model("WabaFlowSubmission", WabaFlowSubmissionSchema);
