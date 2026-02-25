// deletehelpsupportsCollection.js

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGO_URL; // <-- Read from .env

/**
 * Usage:
 *  node deleteContactsCollection.js <userId>
 * or set env `TARGET_USER_ID` and run the script without args.
 *
 * This script will delete only contacts whose `createdBy` matches
 * the provided user id. It will NOT drop the entire `contacts` collection.
 */
async function deleteContactsForUser() {
  // Hard-coded target user id — replace this with the actual user's id string
  // Example: const TARGET_USER_ID = '64a1f2e3b4c5d6e7f8a9b0c';
  const TARGET_USER_ID = "69032996fc434f4104e3f57b";

  const userIdArg = TARGET_USER_ID;

  if (!userIdArg || userIdArg === "REPLACE_WITH_TARGET_USER_ID") {
    console.error(
      "❌ Missing target user id. Edit `TARGET_USER_ID` in this file and set the desired user id."
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    const db = mongoose.connection.db;
    const collection = db.collection("contacts");

    // Build query to match the createdBy field as an ObjectId when possible
    let query;
    if (mongoose.Types.ObjectId.isValid(userIdArg)) {
      query = { createdBy: new mongoose.Types.ObjectId(userIdArg) };
    } else {
      // fallback to string match if non-ObjectId stored (rare)
      query = { createdBy: userIdArg };
    }

    const result = await collection.deleteMany(query);
  } catch (error) {
    console.error("❌ Error deleting user's contacts:", error);
  } finally {
    await mongoose.disconnect();
  }
}

deleteContactsForUser();
