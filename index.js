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
const checkAccountStatus = require("./middlewares/checkAccountStatus");
const checkRole = require("./middlewares/roleCheck");
const { error } = require("console");
const PORT = process.env.PORT || 3003;
const userRoutes = require("./routes/companyAdminAuthRoutes");
const yeastarRoutes = require("./routes/yeastarRoutes");
////for linkux web UI login signature
const deleteTemplateRoutes = require("./routes/deleteTemplateRoutes");
const sendEmail = require("./routes/sendEmailRoutes");
const whatsappEmailActivityRoutes = require("./routes/whatsappEmailActivityRoutes");


const yeastarLoginRoutes = require("./routes/yeastarLoginRoutes");
const scriptRoutes = require("./routes/scriptRoutes");
const callmeServeRoute = require("./routes/callmeServeRoute");
const callmeServerFormCallRoutes = require("./routes/callmeServerFormCallRoutes");
const getExtensionCallHistory = require("./routes/getYeasterCallHistoryRoutes");
const getYeasterValidAccessTokenRoutes = require("./routes/getValidAccessTokenRoutes");
const editProfileRoutes = require("./routes/editProfileRoutes");
const getUserRoutes = require("./routes/getUserRoutes");
const emailPasswordResetRoutes = require("./routes/emailPasswordResetRoutes");
const addEditContactLeadsRoutes = require("./routes/addEditContact&LeadsRoutes");
const getAllContactsOrLeadsRoutes = require("./routes/getAllContactsOrLeadsRoutes");
const contactAndLeadStatusPiplineRoutes = require("./routes/contactAndLeadStatusPiplineRoutes");
const addeditTaskRoutes = require("./routes/taskRoutes");
const getContactActivitiesRoutes = require("./routes/getActivityRoutes");

const addedittagRoutes = require("./routes/tagRoute");
const accountConnect = require("./routes/accountConnectRoutes");
const disconnectAccountRoutes = require("./routes/disconnectAccountRoutes");
const meetingRoutes = require("./routes/meetingRoutes");
const hubSpotContactFetchRoutes = require("./routes/hubSpotContactFetchRoutes");
const zohoContactFetchRoutes = require("./routes/zuhuContactFetchRoutes");
const zohoAuthRoutes = require("./routes/zohoAuthRoutes");
const pipedriveRoutes = require("./routes/pipedriveRoutes");
const metaRoutes = require("./routes/metaRoutes");
const faqRoutes = require("./routes/faqRoutes");
const fetchGoogleContacts = require("./routes/googleContactFatchRoutes");
const saveBulkContactsRoutes = require("./routes/saveBulkContactsRoutes");
const helpSupportRoutes = require("./routes/helpSupportRoutes");
const changePassword = require("./routes/changePasswordRoutes");
const deleteUserRoutes = require("./routes/deleteUserRoutes");
const deleteAllTheDataBySuperAdminRoutes = require("./routes/deleteAllTheDataBySuperAdminRoutes");
const getProfileEventRoutes = require("./routes/getProfileEventRoutes");
const apiKeyRoutes = require("./routes/apiKeyRoutes");
const addEditTempleteRoutes = require("./routes/addEditTempleteRoutes");
const whatsappRoutes = require("./routes/whatsapp.routes");


//for admin routes
const getAdminDetailsRoutes = require("./routes/admin/getAdminDetailsRoutes");
const adminUserRoutes = require("./routes/admin/adminUserRoutes");
const adminUserVerifyRoutes = require("./routes/admin/userVerifyRoutes");
const adminHelpSupportRoutes = require("./routes/admin/adminHelpSupportRoutes");
const superadmin = require("./routes/admin/superAdminRoutes");
const sendBulkEmailRoutes = require("./routes/admin/sendBulkEmailRoutes");
// const chatAgentRoutes = require("./routes/chatAgentRoutes");
const initGraphQL = require("./graphql");

console.log("Setting up Express app...");

app.use(cors());

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(express.static(path.resolve("./public")));
app.use("/user", userRoutes);
// app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));
// ✅ NOW mount GraphQL

initGraphQL(app, checkForAuthentication);
console.log("Setting up routes...");
app.use("/api/yeastar", express.json(), yeastarRoutes);
app.use(
  "/api/yeastar-login",
  express.json(),
  checkForAuthentication(),
  yeastarLoginRoutes
);
app.use("/api/script", scriptRoutes); // script generation (auth)
app.use("/voycell_callback", callmeServeRoute); // serves callme.js (no auth)
app.use("/voyCell_form_call", callmeServerFormCallRoutes); // serves form_call.js (no auth)
app.use("/call", checkForAuthentication(), getExtensionCallHistory);
app.use(
  "/integrations/token",
  checkForAuthentication(),
  getYeasterValidAccessTokenRoutes
);
app.use(
  "/editProfile",
  checkForAuthentication(),
  upload.single("profileImage"),
  editProfileRoutes
);
app.use("/sendEmail", checkForAuthentication(), sendEmail);
app.use("/api/meta", metaRoutes);
app.use("/getUser", checkForAuthentication(), getUserRoutes);
app.use("/changePassword", checkForAuthentication(), changePassword);
app.use("/deleteUser", checkForAuthentication(), deleteUserRoutes);
app.use("/deleteAllUserData", checkForAuthentication(), checkRole(["superadmin"]), deleteAllTheDataBySuperAdminRoutes);
app.use("/deleteTemplate", checkForAuthentication(), deleteTemplateRoutes);
app.use(
  "/whatsapp-email-call-activity",
  checkForAuthentication(),
  whatsappEmailActivityRoutes
);
app.use("/email", emailPasswordResetRoutes);
app.use(
  "/addEditContactLeads",
  checkForAuthentication(),
  addEditContactLeadsRoutes
);
app.use(
  "/getAllContactsOrLeads",
  checkForAuthentication(),
  getAllContactsOrLeadsRoutes
);
app.use(
  "/getContactActivities",
  checkForAuthentication(),
  getContactActivitiesRoutes
);
app.use(
  "/contactAndLeadStatusPipline",
  checkForAuthentication(),
  contactAndLeadStatusPiplineRoutes
);
app.use("/task", checkForAuthentication(), addeditTaskRoutes);
app.use("/tag", checkForAuthentication(), addedittagRoutes);
app.use("/meeting", checkForAuthentication(), meetingRoutes);
app.use("/getProfileEvent", checkForAuthentication(), getProfileEventRoutes);
app.use("/addEditTemplete", checkForAuthentication(), addEditTempleteRoutes);
app.use("/faq", checkForAuthentication(), faqRoutes);
// app.use("/chatAgent", checkForAuthentication(), chatAgentRoutes);

app.use("/api/whatsapp", whatsappRoutes);

app.use(
  "/help-support",
  checkForAuthentication(),
  upload.single("helpAndSupportAttachments"),
  helpSupportRoutes
);
app.use(
  "/connect",
  (req, res, next) => {
    const skipAuthPaths = ["/google-callback", "/microsoft-callback", "/zoom-callback"];
    if (skipAuthPaths.includes(req.path)) {
      return next(); // No token required for callback
    }
    return checkForAuthentication()(req, res, next);
  },
  accountConnect
);
app.use("/disconnect", checkForAuthentication(), disconnectAccountRoutes);
app.use("/api/zoho", zohoAuthRoutes);
app.use("/api/pipedrive", pipedriveRoutes);
app.use(
  "/save-bulk-contacts",
  checkForAuthentication(),
  saveBulkContactsRoutes
);
app.use(
  "/fetch-google-contacts",
  (req, res, next) => {
    const skipAuthPaths = ["/google/callback"];
    if (skipAuthPaths.includes(req.path)) {
      return next(); // No token required for callback
    }
    return checkForAuthentication()(req, res, next);
  },
  fetchGoogleContacts
);
app.use(
  "/fetch-hubspot-contacts",
  (req, res, next) => {
    const skipAuthPaths = ["/hubspot/callback"];
    if (skipAuthPaths.includes(req.path)) {
      return next(); // No token required for callback
    }
    return checkForAuthentication()(req, res, next);
  },
  hubSpotContactFetchRoutes
);

app.use(
  "/fetch-zoho-contacts",
  (req, res, next) => {
    const skipAuthPaths = ["/zoho/callback"];
    if (skipAuthPaths.includes(req.path)) {
      return next(); // No token required for callback
    }
    return checkForAuthentication()(req, res, next);
  },
  zohoContactFetchRoutes
);
app.use("/api-key", checkForAuthentication(), apiKeyRoutes);


// Admin routes
app.use("/admin/user/verify", adminUserVerifyRoutes);
app.use("/send-bulk-email", checkForAuthentication(),
  checkRole(["superadmin"]),
  sendBulkEmailRoutes);
app.use(
  "/admin/user",
  checkForAuthentication(),
  checkRole(["companyAdmin"]),
  adminUserRoutes
);
app.use(
  "/admin",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  getAdminDetailsRoutes
);
app.use(
  "/admin/help-support",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  adminHelpSupportRoutes
);

app.use(
  "/superAdmin",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  superadmin
);


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
      minPoolSize: 1, // Keep it minimal
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
    if (typeof context !== "undefined") {
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

    // ✅ Local/dev mode: Start HTTP server (ONLY if NOT on AWS)
    const IS_AWS = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (!IS_AWS && process.env.NODE_ENV !== "serverless") {

      const PORT = process.env.PORT || 4004;
      // const server = http.createServer(app);

      app.listen(PORT, () =>
        console.log(
          `🚀 Server running on http://localhost:${PORT}`,
          "env",
          process.env.NODE_ENV
        )
      );
    }
  } catch (err) {
    console.error("Startup Error:", err);
  }
})();

// ------------------- SERVERLESS EXPORT (HTTP) -------------------
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
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
});

const t = {
  status: "success",
  message: "company admin fetched",
  page: 1,
  limit: 10,
  totalAdmins: 7,
  totalPages: 1,
  data: [
    {
      _id: "69032996fc434f4104e3f57b",
      email: "makvanayash2112@gmail.com",
      extensionNumber: "3015",
      sipSecret: "G5iknLPBhHu7",
      phonenumbers: [{ countryCode: "91", number: "1235466877444" }],
      createdAt: "2025-10-30T09:02:14.321Z",
      firstname: "yash",
      lastname: "makvana",
    },
  ],
};

const s = {
  status: "success",
  message: "admin details fetched",
  data: {
    _id: "69032996fc434f4104e3f57b",
    email: "makvanayash2112@gmail.com",
    extensionNumber: "3015",
    sipSecret: "G5iknLPBhHu7",
    phonenumbers: [
      {
        countryCode: "91",
        number: "1235466877444",
      },
    ],
    createdAt: "2025-10-30T09:02:14.321Z",
    firstname: "yash",
    lastname: "makvana",
  },
};