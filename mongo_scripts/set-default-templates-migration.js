// set-default-templates-migration.js
// Migration script to populate default whatsapp and email templates for all existing users

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const uri = process.env.MONGO_URL;

const DEFAULT_WHATSAPP_TEMPLATES = [
  {
    whatsappTemplate_id: new mongoose.Types.ObjectId(),
    whatsappTemplateTitle: "Welcome Message",
    whatsappTemplateMessage:
      "Hey {{firstname}}! 👋 Welcome to our platform. Let me know if you need any help getting started.",
    whatsappTemplateIsFavourite: true,
  },
  {
    whatsappTemplate_id: new mongoose.Types.ObjectId(),
    whatsappTemplateTitle: "Follow-up",
    whatsappTemplateMessage:
      "Hi {{firstname}}, just checking in to see if you had a chance to review our last conversation.",
    whatsappTemplateIsFavourite: false,
  },
  {
    whatsappTemplate_id: new mongoose.Types.ObjectId(),
    whatsappTemplateTitle: "Meeting Reminder",
    whatsappTemplateMessage:
      "Reminder: Your meeting with us is scheduled. Let us know if you need to reschedule.",
    whatsappTemplateIsFavourite: false,
  },
  {
    whatsappTemplate_id: new mongoose.Types.ObjectId(),
    whatsappTemplateTitle: "Thank You",
    whatsappTemplateMessage:
      "Thanks a lot for your time today, {{firstname}}! 😊 Looking forward to staying in touch.",
    whatsappTemplateIsFavourite: true,
  },
  {
    whatsappTemplate_id: new mongoose.Types.ObjectId(),
    whatsappTemplateTitle: "Support Offer",
    whatsappTemplateMessage:
      "Hi {{firstname}}, if you have any questions or need assistance, feel free to reply to this message. We're here to help! 🙌",
    whatsappTemplateIsFavourite: false,
  },
];

const DEFAULT_EMAIL_TEMPLATES = [
  {
    emailTemplate_id: new mongoose.Types.ObjectId(),
    emailTemplateTitle: "Welcome Email",
    emailTemplateSubject: "Welcome to Our Platform!",
    emailTemplateBody:
      "Hi {{firstname}},\n\nThank you for joining us! We're excited to have you on board.\n\nBest,\nTeam",
    emailTemplateIsFavourite: true,
  },
  {
    emailTemplate_id: new mongoose.Types.ObjectId(),
    emailTemplateTitle: "Follow-up Email",
    emailTemplateSubject: "Just checking in",
    emailTemplateBody:
      "Hi {{firstname}},\n\nI wanted to follow up on our last conversation. Let me know if you have any questions.\n\nRegards,\n{{senderName}}",
    emailTemplateIsFavourite: false,
  },
  {
    emailTemplate_id: new mongoose.Types.ObjectId(),
    emailTemplateTitle: "Meeting Reminder",
    emailTemplateSubject: "Upcoming Meeting Reminder",
    emailTemplateBody:
      "Hi {{firstname}},\n\nThis is a quick reminder for our meeting.\n\nThanks,\n{{senderName}}",
    emailTemplateIsFavourite: false,
  },
  {
    emailTemplate_id: new mongoose.Types.ObjectId(),
    emailTemplateTitle: "Thank You Email",
    emailTemplateSubject: "Thank You!",
    emailTemplateBody:
      "Hi {{firstname}},\n\nJust wanted to thank you for your time today. Looking forward to our next steps.\n\nCheers,\n{{senderName}}",
    emailTemplateIsFavourite: true,
  },
  {
    emailTemplate_id: new mongoose.Types.ObjectId(),
    emailTemplateTitle: "Feedback Request",
    emailTemplateSubject: "We'd love your feedback!",
    emailTemplateBody:
      "Hi {{firstname}},\n\nWe hope you're enjoying our service. We'd appreciate it if you could share your thoughts or suggestions.\n\nWarm regards,\nTeam",
    emailTemplateIsFavourite: false,
  },
];

async function run() {
  console.log("MongoDB URL:", uri);
  if (!uri) {
    console.error("MONGO_URL is not set in environment");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");

    const db = mongoose.connection.db;
    const usersCollection = db.collection("users");

    const totalUsers = await usersCollection.countDocuments();
    console.log(`📊 Total users in database: ${totalUsers}`);

    if (totalUsers === 0) {
      console.log("ℹ️  No users found in database. Nothing to migrate.");
      return;
    }

    // 1) Populate whatsappTemplates where missing or empty
    const whatsappFilter = {
      $or: [
        { whatsappTemplates: { $exists: false } },
        { whatsappTemplates: { $size: 0 } },
      ],
    };

    const whatsappResult = await usersCollection.updateMany({}, {
      $set: { whatsappTemplates: DEFAULT_WHATSAPP_TEMPLATES },
    });

    console.log("✅ Whatsapp templates update:", {
      matchedCount: whatsappResult.matchedCount,
      modifiedCount: whatsappResult.modifiedCount,
    });

    // 2) Populate emailTemplates where missing or empty
    const emailFilter = {
      $or: [
        { emailTemplates: { $exists: false } },
        { emailTemplates: { $size: 0 } },
      ],
    };

    const emailResult = await usersCollection.updateMany({}, {
      $set: { emailTemplates: DEFAULT_EMAIL_TEMPLATES },
    });

    console.log("✅ Email templates update:", {
      matchedCount: emailResult.matchedCount,
      modifiedCount: emailResult.modifiedCount,
    });

    console.log("🎉 Migration completed successfully");
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log("🔒 Disconnected from MongoDB");
  }
}

run()
  .then(() => {
    console.log("Done");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration script error:", err);
    process.exit(1);
  });
