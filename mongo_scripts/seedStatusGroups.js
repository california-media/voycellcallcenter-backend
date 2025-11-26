#!/usr/bin/env node
require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../models/userModel");

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  "mongodb://localhost:27017/voycellcallcenter";

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected to", MONGO_URI);

    const userId = "69032996fc434f4104e3f57b";

    const contactStatuses = [
      { value: "interested", label: "Interested", group: 1 },
      { value: "notInterested", label: "Not Interested", group: 1 },
      { value: "called", label: "Called", group: 2 },
      { value: "notValid", label: "Not Valid", group: 2 },
      { value: "contacted", label: "Contacted", group: 2 },
      { value: "win", label: "Win", group: 3 },
      { value: "lost", label: "Lost", group: 3 },
    ];

    const leadStatuses = [
      { value: "interested", label: "Interested", group: 1 },
      { value: "followup", label: "Follow Up", group: 2 },
      { value: "win", label: "Win", group: 3 },
      { value: "lost", label: "Lost", group: 3 },
    ];

    const update = { contactStatuses, leadStatuses };

    const user = await User.findByIdAndUpdate(userId, update, { new: true });

    if (!user) {
      console.error("User not found:", userId);
      process.exitCode = 2;
      return;
    }

    console.log("Successfully updated user:", user._id.toString());
    console.log(
      "Contact statuses set to:",
      JSON.stringify(user.contactStatuses, null, 2)
    );
    console.log(
      "Lead statuses set to:",
      JSON.stringify(user.leadStatuses, null, 2)
    );
  } catch (err) {
    console.error("Error running seed script:", err);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (e) {
      // ignore
    }
  }
}

run();
