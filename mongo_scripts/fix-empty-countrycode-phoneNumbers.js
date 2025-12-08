// fix-empty-countrycode-phoneNumbers.js
// Migration script to set empty countryCode values to '971' in contacts and leads

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGO_URL;

async function fixCountryCodes() {
  console.log(
    "MongoDB URL:",
    uri ? uri.replace(/:(.*)@/, "://****:****@") : uri
  );
  if (!uri) {
    console.error("❌ MONGO_URL is not set in environment.");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;

    const collectionsToFix = ["contacts", "leads"];
    const phoneFields = ["phonenumbers", "phoneNumbers"]; // handle common variants

    for (const collName of collectionsToFix) {
      const coll = db.collection(collName);
      console.log(`\n🔍 Processing collection: ${collName}`);

      for (const field of phoneFields) {
        // Filter for documents that have at least one element with empty countryCode
        const filter = {
          [field]: { $elemMatch: { countryCode: "" } },
        };

        // Update array elements whose countryCode is empty string to '971'
        const update = {
          $set: {
            [`${field}.$[elem].countryCode`]: "971",
          },
        };

        const options = {
          arrayFilters: [{ "elem.countryCode": "" }],
        };

        // Count how many docs match the filter first (for logging)
        const matchingDocs = await coll.countDocuments(filter);
        if (matchingDocs === 0) {
          console.log(`• Field '${field}': 0 documents need update`);
          continue;
        }

        console.log(
          `• Field '${field}': ${matchingDocs} documents will be updated (if any elements match).`
        );

        const result = await coll.updateMany(filter, update, options);

        console.log(
          `  → matched: ${result.matchedCount}, modified: ${result.modifiedCount}`
        );
      }
    }

    console.log("\n✅ Country code migration completed");
  } catch (err) {
    console.error("❌ Error during migration:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("🔒 Disconnected from MongoDB");
  }
}

// Run
fixCountryCodes()
  .then(() => {
    console.log("🎉 Script finished");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Script failed:", err);
    process.exit(1);
  });
