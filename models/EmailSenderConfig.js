const { Schema, model } = require("mongoose");

// Stores the list of "From" email addresses the superadmin can use when sending
// broadcast emails. Any verified address on the SMTP account can be listed here.
const emailSenderConfigSchema = new Schema(
  {
    email:     { type: String, required: true, unique: true, trim: true, lowercase: true },
    name:      { type: String, default: "VOYCELL", trim: true },  // display name shown in inbox
    isDefault: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Ensure only one document can be the default at a time (handled in controller)
emailSenderConfigSchema.index({ isDefault: 1 });

const EmailSenderConfig = model("EmailSenderConfig", emailSenderConfigSchema);
module.exports = EmailSenderConfig;
