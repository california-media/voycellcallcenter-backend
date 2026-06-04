const mongoose = require("mongoose");

const responseSchema = new mongoose.Schema({
  type:     { type: String, enum: ["text", "image", "audio", "video", "document"], default: "text" },
  text:     { type: String },
  mediaUrl: { type: String },
  caption:  { type: String },
}, { _id: false });

const businessHoursSchema = new mongoose.Schema({
  enabled:   { type: Boolean, default: false },
  timezone:  { type: String, default: "UTC" },
  days:      { type: [String], default: ["Mon","Tue","Wed","Thu","Fri"] },
  startTime: { type: String, default: "09:00" },
  endTime:   { type: String, default: "18:00" },
}, { _id: false });

const WabaBasicReplySchema = new mongoose.Schema({
  companyAdmin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name:         { type: String, required: true },
  trigger:      { type: String, required: true },
  matchCriteria:{ type: String, enum: ["exact", "contains"], default: "contains" },
  responses:    { type: [responseSchema], default: [] },
  businessHours:{ type: businessHoursSchema, default: () => ({}) },
  isActive:     { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model("WabaBasicReply", WabaBasicReplySchema);
