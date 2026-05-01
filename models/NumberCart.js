const { Schema, model } = require("mongoose");

/**
 * NumberCart — one document per user, holds their pending number purchases.
 * Items are added from BrowseNumbers and purchased from the cart page.
 */

const cartItemSchema = new Schema(
  {
    did_id:             { type: Number,  required: true },
    number:             { type: String,  required: true },
    country:            { type: String,  default: "" },
    country_short_name: { type: String,  default: "" },
    city:               { type: String,  default: "" },
    channels:           { type: Number,  default: 1 },

    // Raw DIDLogic prices
    activation:         { type: Number, default: 0 },
    monthly_fee:        { type: Number, default: 0 },
    per_minute:         { type: Number, default: 0 },

    // Margin-adjusted prices (what the company admin pays)
    ourActivationPrice: { type: Number, default: 0 },
    ourMonthlyPrice:    { type: Number, default: 0 },
    ourPerMinute:       { type: Number, default: 0 },

    // KYC requirements for this number
    required_documents: [{ type: { type: Number }, name: String }],

    addedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const numberCartSchema = new Schema(
  {
    // Each user gets exactly one cart
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    items:  [cartItemSchema],
  },
  { timestamps: true }
);

module.exports = model("NumberCart", numberCartSchema);
