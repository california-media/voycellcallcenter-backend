const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema({
  nodeId:    { type: String },
  nodeType:  { type: String },
  question:  { type: String },
  answer:    { type: mongoose.Schema.Types.Mixed },
  answeredAt:{ type: Date, default: Date.now },
}, { _id: false });

const WabaFlowSessionSchema = new mongoose.Schema({
  flow:          { type: mongoose.Schema.Types.ObjectId, ref: "WabaFlow", required: true, index: true },
  companyAdmin:  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  contactPhone:  { type: String, required: true, index: true },
  currentNodeId: { type: String },
  answers:       { type: [answerSchema], default: [] },
  status:        { type: String, enum: ["active", "completed", "timeout", "error"], default: "active" },
  startedAt:     { type: Date, default: Date.now },
  lastActivityAt:{ type: Date, default: Date.now },
  completedAt:   { type: Date },
}, { timestamps: true });

// Index for timeout cron: find active sessions older than 24h
WabaFlowSessionSchema.index({ status: 1, lastActivityAt: 1 });

module.exports = mongoose.model("WabaFlowSession", WabaFlowSessionSchema);
