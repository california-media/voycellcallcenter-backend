import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGO_URL;

const USER_ID = "69086406d3528368397525eb";

const leadStatuses = [
  { value: "interested", label: "Interested" },
  { value: "notInterested", label: "Not Interested" },
  { value: "called", label: "Called" },
  { value: "notValid", label: "Not Valid" },
  { value: "contacted", label: "Contacted" },
  { value: "win", label: "Win" },
  { value: "lost", label: "Lost" },
];

async function populateLeadStatuses() {
  if (!uri) {
    console.error("MONGO_URL is not defined in environment");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;

    const result = await db
      .collection("users")
      .updateOne(
        { _id: new mongoose.Types.ObjectId(USER_ID) },
        { $set: { leadStatuses: leadStatuses } },
        { upsert: false }
      );

    if (result.matchedCount === 0) {
      console.log(`ℹ️  No user found with _id ${USER_ID}`);
    } else if (result.modifiedCount === 1) {
      console.log(`✅ leadStatuses updated for user ${USER_ID}`);
    } else {
      console.log(
        "⚠️  Update executed but no modifications were made (maybe identical data)"
      );
    }
  } catch (error) {
    console.error("❌ Error updating leadStatuses:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔒 Disconnected from MongoDB");
  }
}

populateLeadStatuses();
