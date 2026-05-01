const { Schema, model } = require("mongoose");

/**
 * DIDIdentity — maps a DIDLogic identity ID to the company admin who created it.
 *
 * DIDLogic stores all identities at the account level (shared API token).
 * This model lets us scope them per user so each company admin only sees
 * and manages their own identities.
 */
const didIdentitySchema = new Schema(
  {
    didlogicId: { type: Number, required: true, unique: true }, // DIDLogic identity.id
    userId:     { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name:       { type: String, required: true },
    archived:   { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = model("DIDIdentity", didIdentitySchema);
