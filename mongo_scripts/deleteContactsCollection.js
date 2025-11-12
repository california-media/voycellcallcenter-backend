// deleteContactsCollection.js

import mongoose from "mongoose";

const uri = "mongodb+srv://voycellcallcenterdb:voycellcallcenterdb@cluster0.lrzweyr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"; // Replace with your actual MongoDB connection string

async function deleteContactsCollection() {
  try {
    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;

    const collections = await db.listCollections({ name: "contacts" }).toArray();

    if (collections.length > 0) {
      await db.dropCollection("contacts");
      console.log("🗑️  'contacts' collection deleted successfully");
    } else {
      console.log("ℹ️  'contacts' collection does not exist");
    }
  } catch (error) {
    console.error("❌ Error deleting collection:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔒 Disconnected from MongoDB");
  }
}

deleteContactsCollection();
