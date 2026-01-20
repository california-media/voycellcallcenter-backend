import mongoose from "mongoose";

const whatsappMessageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    wabaId: String,
    from: String,
    message: Object,
    timestamp: String
}, { timestamps: true });

export default mongoose.model("WhatsAppMessage", whatsappMessageSchema);
