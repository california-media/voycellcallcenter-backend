const mongoose = require("mongoose");

const whatsappMessageSchema = new mongoose.Schema(
  {
    // 🔗 Ownership
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    phoneNumberId: {
      type: String, // WABA phone_number_id
      required: true,
      index: true,
    },

    conversationId: {
      type: String, // wa_id (customer number) → used for chat grouping
      index: true,
    },

    senderName: {
      type: String, // Display name of the sender
    },

    senderWabaId: {
      type: String, // WABA ID of the sender
      index: true,
    },

    s3dataurl: {
      type: String, // S3 URL of the media
    },

    attachmentName: {
      type: String, // Original name of the attachment
    },

    // ↔️ Direction
    direction: {
      type: String,
      enum: ["incoming", "outgoing"],
      required: true,
      index: true,
    },

    // 📞 Participants
    from: {
      type: String, // WhatsApp number
      required: true,
      index: true,
    },

    to: {
      type: String, // WhatsApp number
      required: true,
      index: true,
    },

    // 🧩 Message classification
    messageType: {
      type: String,
      enum: [
        "text",
        "image",
        "video",
        "audio",
        "voice",
        "document",
        "sticker",
        "location",
        "contacts",
        "interactive",
        "template",
        "reaction",
        "system"
      ],
      required: true,
      index: true,
    },

    // 📦 Message content (TYPE-SPECIFIC)
    content: {
      // text
      text: String,

      // media
      mediaId: String,           // Meta media id
      mimeType: String,
      caption: String,
      fileName: String,
      fileSize: Number,
      sha256: String,

      // media URLs (your CDN / S3)
      mediaUrl: String,
      thumbnailUrl: String,

      // audio / voice
      isVoice: Boolean,
      duration: Number,

      // location
      latitude: Number,
      longitude: Number,
      address: String,
      name: String,

      // contacts
      contacts: Array,

      // interactive
      interactiveType: String,   // button_reply, list_reply
      interactiveId: String,
      interactiveTitle: String,

      // template
      // template
      template: {
        name: String,
        language: String,

        components: Array, // full template structure from WabaTemplate

        params: Object, // actual values used

        resolved: {
          header: String,
          body: String,
          buttons: [
            {
              text: String,
              payload: String,
            }
          ]
        }
      }
    },

    // 🧾 Meta / WhatsApp identifiers
    metaMessageId: {
      type: String, // wamid.xxx
      index: true,
    },

    contextMessageId: {
      type: String, // reply to which message
    },

    // 📬 Message lifecycle
    status: {
      type: String,
      enum: [
        "queued",
        "sent",
        "delivered",
        "read",
        "received",
        "failed"
      ],
      default: "queued",
      index: true,
    },

    error: {
      code: String,
      message: String,
    },

    // 🕒 Time
    messageTimestamp: {
      type: Date, // WhatsApp timestamp
      index: true,
    },

    // 🧠 Raw Meta payload (for debugging)
    raw: {
      type: Object,
    },
  },
  {
    timestamps: true, // createdAt / updatedAt
  }
);

// 🔍 Helpful compound indexes
whatsappMessageSchema.index({
  userId: 1,
  conversationId: 1,
  messageTimestamp: -1,
});

module.exports = mongoose.model("WhatsAppMessage", whatsappMessageSchema);