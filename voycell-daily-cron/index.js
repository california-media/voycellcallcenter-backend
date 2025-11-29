require("dotenv").config();
console.log("Environment Variables Loaded");

const mongoose = require("mongoose");
const HelpSupport = require("./models/helpSupportModel");

// ------------------- TICKET AUTO-CLOSE FUNCTION -------------------
/**
 * Close tickets that have been inactive for more than 48 hours
 * @returns {Object} Result object with counts
 */
const closeInactiveTickets = async () => {
  try {
    console.log("🔄 Starting ticket auto-close process...");

    // Calculate the cutoff time (48 hours ago)
    const fortyEightHoursAgo = new Date();
    fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

    console.log(
      `📅 Cutoff time: ${fortyEightHoursAgo.toISOString()} (48 hours ago)`
    );

    // Find tickets that:
    // 1. Are not already closed
    // 2. Have lastMessageAt older than 48 hours ago
    const ticketsToClose = await HelpSupport.find({
      status: { $ne: "closed" },
      lastMessageAt: { $lt: fortyEightHoursAgo },
    });

    console.log(`📊 Found ${ticketsToClose.length} tickets to close`);

    if (ticketsToClose.length === 0) {
      return {
        success: true,
        closedCount: 0,
        message: "No tickets to close",
      };
    }

    // Update all matching tickets to closed status
    const result = await HelpSupport.updateMany(
      {
        status: { $ne: "closed" },
        lastMessageAt: { $lt: fortyEightHoursAgo },
      },
      {
        $set: { status: "closed" },
      }
    );

    console.log(
      `✅ Successfully closed ${result.modifiedCount} ticket(s) due to inactivity`
    );

    return {
      success: true,
      closedCount: result.modifiedCount,
      ticketIds: ticketsToClose.map((t) => t._id),
      message: `Successfully closed ${result.modifiedCount} inactive ticket(s)`,
    };
  } catch (error) {
    console.error("❌ Error in closeInactiveTickets:", error);
    throw error;
  }
};

// ------------------- DB CONNECT -------------------
let isConnected = false;

const connectToDatabase = async () => {
  if (isConnected) {
    console.log("✅ Using existing MongoDB connection");
    return;
  }

  try {
    console.log("🔄 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URL, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ Database connection failed:", err);
    throw err;
  }
};

// ------------------- LAMBDA HANDLER -------------------
/**
 * AWS Lambda handler function for EventBridge cron trigger
 * @param {Object} event - EventBridge event object
 * @param {Object} context - Lambda context object
 * @returns {Object} Response object
 */
module.exports.handler = async (event, context) => {
  // AWS Lambda context optimization
  context.callbackWaitsForEmptyEventLoop = false;

  console.log("🚀 Lambda function invoked");
  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    // Connect to database
    await connectToDatabase();

    // Execute the auto-close tickets logic
    console.log("⏰ Running daily ticket auto-close job...");
    const result = await closeInactiveTickets();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Daily ticket auto-close job completed successfully",
        ...result,
      }),
    };
  } catch (error) {
    console.error("❌ Lambda execution error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: "Failed to execute daily ticket auto-close job",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      }),
    };
  }
};

// ------------------- LOCAL TESTING -------------------
// Run directly if not in Lambda environment (for local testing)
if (require.main === module) {
  (async () => {
    console.log("🧪 Running in local testing mode...");

    try {
      await connectToDatabase();

      const result = await closeInactiveTickets();
      console.log("📊 Test Result:", JSON.stringify(result, null, 2));

      process.exit(0);
    } catch (err) {
      console.error("❌ Test Error:", err);
      process.exit(1);
    }
  })();
}
