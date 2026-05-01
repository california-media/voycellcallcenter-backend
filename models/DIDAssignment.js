const { Schema, model } = require("mongoose");

// Tracks which DID number is assigned to which company admin
const didAssignmentSchema = new Schema(
  {
    number: { type: String, required: true, index: true },
    countryName: { type: String, default: "" },
    area: { type: String, default: "" },
    numberType: { type: String, enum: ["local", "mobile", "tollfree", "voip"], default: "local" },
    didlogicMonthlyFee: { type: Number, default: 0 },
    ourMonthlyPrice:    { type: Number, default: 0 },
    didlogicActivation: { type: Number, default: 0 },   // provider's one-time activation fee
    ourActivationPrice: { type: Number, default: 0 },   // our activation price (with margin)
    channels:           { type: Number, default: 1 },   // max simultaneous calls
    marginPercent:      { type: Number, default: 0 },
    companyAdminId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    status: { type: String, enum: ["available", "assigned"], default: "available" },
    assignedAt: { type: Date, default: null },
    // Agent assignment (optional — admin assigns a purchased number to one of their agents)
    assignedAgentId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    assignedAgentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = model("DIDAssignment", didAssignmentSchema);
