// backfill-email-verified-flag.js
// Migration: set emailVerified: false on all users that are missing the field.
// Users that already have emailVerified: true are left untouched.

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGO_URL;

async function backfillEmailVerified() {
  console.log("MongoDB URL:", uri);

  try {
    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    const totalUsers = await usersCollection.countDocuments();
    console.log(`📊 Total users in database: ${totalUsers}`);

    const missing = await usersCollection.countDocuments({ emailVerified: { $exists: false } });
    console.log(`🔍 Users missing emailVerified field: ${missing}`);

    if (missing === 0) {
      console.log("ℹ️  All users already have the emailVerified field. Nothing to do.");
      return;
    }

    const result = await usersCollection.updateMany(
      { emailVerified: { $exists: false } },
      { $set: { emailVerified: false } }
    );

    console.log("✅ Migration completed successfully!");
    console.log(`📝 Users matched: ${result.matchedCount}`);
    console.log(`✏️  Users modified: ${result.modifiedCount}`);
  } catch (error) {
    console.error("❌ Error during migration:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("🔒 Disconnected from MongoDB");
  }
}

backfillEmailVerified()
  .then(() => {
    console.log("🎉 Migration script finished");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Migration script failed:", error);
    process.exit(1);
  });
