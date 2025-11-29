const mongoose = require("mongoose");

// Simplified User model for cron job - only fields needed for subscription alerts
const userSchema = new mongoose.Schema(
  {
    firstname: {
      type: String,
    },
    lastname: {
      type: String,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    stripeCustomerId: {
      type: String,
      sparse: true,
    },
    trialEnd: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
