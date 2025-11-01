require("dotenv").config();
console.log("Environment Variables Loaded:");
// super admin email password
// email : superadmin@example.com
// password : SuperSecure123
const express = require("express");
const app = express();
const cors = require("cors");

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const multer = require("multer");

const storage = multer.memoryStorage();
const upload = multer({ storage });

const mongoose = require("mongoose");
const serverless = require("serverless-http");


console.log("Connecting to MongoDB...");
const { checkForAuthentication } = require("./middlewares/authentication");
const checkRole = require("./middlewares/roleCheck");
const { error } = require("console");
const PORT = process.env.PORT || 3003;
const userRoutes = require("./routes/companyAdminAuthRoutes");
const yeastarRoutes = require("./routes/yeastarRoutes");
////for linkux web UI login signature
const yeastarLoginRoutes = require("./routes/yeastarLoginRoutes");
const scriptRoutes = require("./routes/scriptRoutes");
const callmeServeRoute = require("./routes/callmeServeRoute");
const editProfileRoutes = require("./routes/editProfileRoutes");
const getUserRoutes = require("./routes/getUserRoutes");
const emailPasswordResetRoutes = require("./routes/emailPasswordResetRoutes");
const addEditContactLeadsRoutes = require("./routes/addEditContact&LeadsRoutes");
const getAllContactsOrLeadsRoutes = require("./routes/getAllContactsOrLeadsRoutes");
const contactAndLeadStatusPiplineRoutes = require("./routes/contactAndLeadStatusPiplineRoutes");

//for admin routes
const getAdminDetailsRoutes = require("./routes/admin/getAdminDetailsRoutes");
const adminUserRoutes = require("./routes/admin/adminUserRoutes");
const adminUserVerifyRoutes = require("./routes/admin/userVerifyRoutes");

console.log("Setting up Express app...");

app.use(cors());


app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(express.static(path.resolve("./public")));
app.use("/user", userRoutes);
// app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));


console.log("Setting up routes...");
app.use("/api/yeastar", express.json(), yeastarRoutes);
app.use("/api/yeastar-login", express.json(), checkForAuthentication(), yeastarLoginRoutes);
app.use("/api/script", scriptRoutes); // script generation (auth)
app.use("/voycell_callback", callmeServeRoute); // serves callme.js (no auth)
app.use("/editProfile", checkForAuthentication(), upload.single("profileImage"), editProfileRoutes);
app.use("/getUser", checkForAuthentication(), getUserRoutes);
app.use("/email", emailPasswordResetRoutes);
app.use("/addEditContactLeads", checkForAuthentication(), addEditContactLeadsRoutes);
app.use("/getAllContactsOrLeads", checkForAuthentication(), getAllContactsOrLeadsRoutes);
app.use("/contactAndLeadStatusPipline", checkForAuthentication(), contactAndLeadStatusPiplineRoutes);

// Admin routes
app.use("/admin/user/verify", adminUserVerifyRoutes);
app.use("/admin/user", checkForAuthentication(), checkRole(["companyAdmin"]), adminUserRoutes);
app.use("/admin", checkForAuthentication(), checkRole(["superadmin"]), getAdminDetailsRoutes);


app.use("/check", (req, res) => {
  res.json({ message: "API checkPage" });
});
app.use("/", (req, res) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.originalUrl}`);

  res.json({ message: "API Homepage" });
});

console.log("Setting up error handling...");

// ------------------- DB CONNECT -------------------
let cachedConnection = null;

const connectToDatabase = async () => {
  // Check if connection exists AND is actually working
  if (cachedConnection && mongoose.connection.readyState === 1) {
    console.log("♻️ Using cached MongoDB connection");
    return cachedConnection;
  }

  try {
    // Close any stale connections
    if (mongoose.connection.readyState !== 0) {
      console.log("🔄 Closing stale connection...");
      await mongoose.connection.close();
    }

    console.log("MongoDB URL log:", process.env.MONGO_URL);
    
    // Optimized settings for AWS Lambda
    const connection = await mongoose.connect(process.env.MONGO_URL, {
      maxPoolSize: 10, // Lower pool size for Lambda (not 200!)
      minPoolSize: 1,  // Keep it minimal
      serverSelectionTimeoutMS: 10000, // Increase timeout
      socketTimeoutMS: 45000, // Socket timeout
      connectTimeoutMS: 10000, // Connection timeout
      retryWrites: true,
      retryReads: true,
      maxIdleTimeMS: 10000, // Close idle connections faster
      // Disable buffering - fail fast instead of queuing
      bufferCommands: false,
    });

    cachedConnection = connection;
    console.log("✅ MongoDB connected successfully");
    return connection;
  } catch (err) {
    console.error("❌ Database connection failed:", err);
    cachedConnection = null;
    throw err;
  }
};

// ------------------- CRITICAL: Context settings -------------------
// Tell Lambda not to wait for empty event loop
if (process.env.NODE_ENV === "serverless") {
  app.use((req, res, next) => {
    // This is crucial for Lambda
    if (typeof context !== 'undefined') {
      context.callbackWaitsForEmptyEventLoop = false;
    }
    next();
  });
}

// ------------------- SOCKET HANDLER -------------------
const http = require("http");

// ------------------- START APP -------------------
(async () => {
  try {
    await connectToDatabase();

    // ✅ Local/dev mode: Start HTTP + Socket.IO
    if (process.env.NODE_ENV !== "serverless") {
      const PORT = process.env.PORT || 3000;
      const server = http.createServer(app);

      server.listen(PORT, () =>
        console.log(`🚀 Server running on http://localhost:${PORT}`)
      );
    }
  } catch (err) {
    console.error("Startup Error:", err);
  }
})();

// ------------------- SERVERLESS EXPORT -------------------
module.exports.handler = serverless(async (event, context) => {
  // CRITICAL: Prevent Lambda from waiting for connections to close
  context.callbackWaitsForEmptyEventLoop = false;
  
  try {
    await connectToDatabase();
    return app(event, context);
  } catch (error) {
    console.error("Lambda handler error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
});

// (async () => {
//   console.log("Connecting to MongoDB...");

//   try {
//     console.log("MongoDB URL log:", process.env.MONGO_URL);

//     await mongoose.connect(process.env.MONGO_URL);
//     console.log("MongoDB connected successfully");
//     // app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
//     const http = require("http");
//     const { Server } = require("socket.io");
//     const socketHandler = require("./socket/socketHandler"); // create this file

//     const server = http.createServer(app);

//     const io = new Server(server, {
//       cors: {
//         origin: "*", // or set to your frontend domain
//         methods: ["GET", "POST"],
//       },
//     });

//     // pass io to socket handler
//     socketHandler(io);

//     server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
//   } catch (err) {
//     console.error("Database connection failed:", err);
//   }
// })();
// module.exports.handler = serverless(app);

// // let isConnected = false;

// // const connectToDatabase = async () => {
// //   if (isConnected) {
// //     return;
// //   }
// //   try {
// //     console.log("Console 7 MongoDB URL log:", process.env.MONGO_URL);
// //     await mongoose.connect(process.env.MONGO_URL, {
// //       useNewUrlParser: true,
// //       useUnifiedTopology: true,

// //     });
// //     isConnected = true;
// //     console.log("Console 8 MongoDB connected successfully");
// //   } catch (err) {
// //     console.error("Console 9 Database connection failed:", err);
// //     throw err;
// //   }
// // };

// // console.log("Console 10 last log before export");

// // module.exports.handler = serverless(async (event, context) => {
// //   await connectToDatabase();
// //   return app(event, context);
// // });
