// set-default-statuses-migration.js
// Migration script to update contactStatuses and leadStatuses for all existing users

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGO_URL;

// Define the new default values
const DEFAULT_CONTACT_STATUSES = [
  { value: "interested", label: "Interested" },
  { value: "notInterested", label: "Not Interested" },
  { value: "called", label: "Called" },
  { value: "notValid", label: "Not Valid" },
  { value: "contacted", label: "Contacted" },
  { value: "win", label: "Win" },
  { value: "lost", label: "Lost" },
  { value: "noAnswer", label: "No Answer" },
];

const DEFAULT_LEAD_STATUSES = [
  { value: "interested", label: "Interested", group: 1, isDefault: true },
  { value: "followup", label: "Follow Up", group: 2, isDefault: true },
  { value: "win", label: "Win", group: 3, isDefault: true },
  { value: "lost", label: "Lost", group: 3, isDefault: false },
  { value: "callBack", label: "Call Back", group: 4, isDefault: false },
  { value: "noAnswer", label: "No Answer", group: 4, isDefault: false },
];

async function updateDefaultStatuses() {
  console.log("MongoDB URL log:", uri);

  try {
    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    // Check how many users exist
    const totalUsers = await usersCollection.countDocuments();
    console.log(`📊 Total users in database: ${totalUsers}`);

    if (totalUsers === 0) {
      console.log("ℹ️  No users found in database. Nothing to migrate.");
      return;
    }

    // Update all users with the new default statuses
    const result = await usersCollection.updateMany(
      {}, // Match all users
      {
        $set: {
          contactStatuses: DEFAULT_CONTACT_STATUSES,
          leadStatuses: DEFAULT_LEAD_STATUSES,
        },
      }
    );

    console.log("✅ Migration completed successfully!");
    console.log(`📝 Users matched: ${result.matchedCount}`);
    console.log(`✏️  Users modified: ${result.modifiedCount}`);

    if (result.modifiedCount === 0 && result.matchedCount > 0) {
      console.log(
        "ℹ️  No users were modified (they might already have the correct values)"
      );
    }
  } catch (error) {
    console.error("❌ Error during migration:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("🔒 Disconnected from MongoDB");
  }
}

// Run the migration
updateDefaultStatuses()
  .then(() => {
    console.log("🎉 Migration script finished");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Migration script failed:", error);
    process.exit(1);
  });
