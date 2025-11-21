// deletepipelinesCollection.js

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGO_URL; // <-- Read from .env

async function deletepipelinesCollection() {
console.log("MongoDB URL log:", uri);

  try {
    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;

    const collections = await db.listCollections({ name: "pipelines" }).toArray();

    if (collections.length > 0) {
      await db.dropCollection("pipelines");
      console.log("🗑️  'pipelines' collection deleted successfully");
    } else {
      console.log("ℹ️  'pipelines' collection does not exist");
    }
  } catch (error) {
    console.error("❌ Error deleting collection:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔒 Disconnected from MongoDB");
  }
}

deletepipelinesCollection();
