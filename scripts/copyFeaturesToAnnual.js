/**
 * Script: copyFeaturesToAnnual.js
 * Copies features + commonFeatures from the "Half Yearly" plan to the "Annual" plan.
 *
 * Run from the voycellcallcenter-backend folder:
 *   node scripts/copyFeaturesToAnnual.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Plan = require("../models/Plan");

async function main() {
  await mongoose.connect(process.env.MONGO_URL);
  console.log("Connected to MongoDB\n");

  const source = await Plan.findOne({ name: "Half Yearly", isDeleted: false });
  if (!source) {
    console.error('Could not find a plan named "Half Yearly". Available plans:');
    const all = await Plan.find({ isDeleted: false }).select("name");
    all.forEach((p) => console.log(" -", p.name));
    process.exit(1);
  }

  const target = await Plan.findOne({ name: "Annual", isDeleted: false });
  if (!target) {
    console.error('Could not find a plan named "Annual". Available plans:');
    const all = await Plan.find({ isDeleted: false }).select("name");
    all.forEach((p) => console.log(" -", p.name));
    process.exit(1);
  }

  console.log(`Source: "${source.name}" (${source._id})`);
  console.log(`  features:       ${source.features.length} items`);
  console.log(`  commonFeatures: ${source.commonFeatures.length} items`);
  console.log();
  console.log(`Target: "${target.name}" (${target._id})`);
  console.log(`  features (before):       ${target.features.length} items`);
  console.log(`  commonFeatures (before): ${target.commonFeatures.length} items`);

  target.features = source.features.map((f) => ({ text: f.text, description: f.description, order: f.order }));
  target.commonFeatures = source.commonFeatures.map((f) => ({ text: f.text, description: f.description, order: f.order }));
  await target.save();

  console.log();
  console.log("Done!");
  console.log(`  features (after):       ${target.features.length} items`);
  console.log(`  commonFeatures (after): ${target.commonFeatures.length} items`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
