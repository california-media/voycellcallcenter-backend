const mongoose = require("mongoose");

const whatsappMessageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    wabaId: String,
    from: String,
    message: Object,
    timestamp: String
}, { timestamps: true });

module.exports = mongoose.model("WhatsAppMessage", whatsappMessageSchema);