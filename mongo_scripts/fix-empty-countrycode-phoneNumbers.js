// fix-empty-countrycode-phoneNumbers.js
// Migration script to set empty countryCode values to '971' in contacts and leads

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGO_URL;

async function fixCountryCodes() {
  if (!uri) {
    console.error("❌ MONGO_URL is not set in environment.");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;

    const collectionsToFix = ["contacts", "leads"];
    const phoneFields = ["phonenumbers", "phoneNumbers"]; // handle common variants

    for (const collName of collectionsToFix) {
      const coll = db.collection(collName);
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
          continue;
        }

        const result = await coll.updateMany(filter, update, options);
      }
    }

  } catch (err) {
    console.error("❌ Error during migration:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

// Run
fixCountryCodes()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    process.exit(1);
  });
