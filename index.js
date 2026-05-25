require("dotenv").config();
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

const { loadConfigPromise } = require("./utils/getConfig");
const { loadSSMPromise } = require("./utils/ssmLoader");


const storage = multer.memoryStorage();
const upload = multer({ storage });


const mongoose = require("mongoose");
const serverless = require("serverless-http");

const { checkForAuthentication } = require("./middlewares/authentication");
const checkAccountStatus = require("./middlewares/checkAccountStatus");
const checkRole = require("./middlewares/roleCheck");
const { error } = require("console");
const PORT = process.env.PORT || 3003;
const userRoutes = require("./routes/companyAdminAuthRoutes");
const authUnlockRoutes = require("./routes/authUnlockRoutes");
const yeastarRoutes = require("./routes/yeastarRoutes");
////for linkux web UI login signature
const deleteTemplateRoutes = require("./routes/deleteTemplateRoutes");
const sendEmail = require("./routes/sendEmailRoutes");
const whatsappEmailActivityRoutes = require("./routes/whatsappEmailActivityRoutes");


const yeastarLoginRoutes = require("./routes/yeastarLoginRoutes");
const scriptRoutes = require("./routes/scriptRoutes");
const callmeServeRoute = require("./routes/callmeServeRoute");
// const callmeServerFormCallRoutes = require("./routes/callmeServerFormCallRoutes");
const getExtensionCallHistory = require("./routes/getYeasterCallHistoryRoutes");
// const getYeasterValidAccessTokenRoutes = require("./routes/getValidAccessTokenRoutes");
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
// const pipedriveRoutes = require("./routes/pipedriveRoutes");
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
const hubspotAuthRoutes = require("./routes/hubspot.routes");
const pipedriveAuthRoutes = require("./routes/pipedrive.routes");
const billingRoutes      = require("./routes/billingRoutes");
const creditsRoutes      = require("./routes/creditsRoutes");
const liveBillingRoutes  = require("./routes/liveBillingRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const dashboardStatsRoutes = require("./routes/dashboardStatsRoutes");
const didlogicRoutes = require("./routes/didlogicRoutes");
const didlogicAdminRoutes = require("./routes/admin/didlogicAdminRoutes");
const kycDocumentRoutes       = require("./routes/kycDocumentRoutes");
const numberInventoryRoutes   = require("./routes/numberInventoryRoutes");
const numberCartRoutes         = require("./routes/numberCartRoutes");
const callRateRoutes           = require("./routes/callRateRoutes");
const powerDialerRoutes        = require("./routes/powerDialerRoutes");
const systemEmailRoutes        = require("./routes/admin/systemEmailRoutes");
const activationEmailConfigRoutes = require("./routes/admin/activationEmailConfigRoutes");

//for admin routes
const getAdminDetailsRoutes = require("./routes/admin/getAdminDetailsRoutes");
const adminUserRoutes = require("./routes/admin/adminUserRoutes");
const adminUserVerifyRoutes = require("./routes/admin/userVerifyRoutes");
const adminHelpSupportRoutes = require("./routes/admin/adminHelpSupportRoutes");
const superadmin = require("./routes/admin/superAdminRoutes");
const superAdminDashboardRoutes = require("./routes/admin/superAdminDashboardRoutes");
const planAdminRoutes = require("./routes/admin/planAdminRoutes");
const couponAdminRoutes = require("./routes/admin/couponAdminRoutes");
const globalSettingsAdminRoutes = require("./routes/admin/globalSettingsAdminRoutes");
const sendBulkEmailRoutes = require("./routes/admin/sendBulkEmailRoutes");
const apiLogsRoutes = require("./routes/admin/apiLogsRoutes");
const aiRoutes = require("./routes/aiRoutes");
const userSessionsRoutes = require("./routes/admin/userSessionsRoutes");
const { saveUserSession } = require("./controllers/admin/userSessionsController");
const userActivityRoutes = require("./routes/admin/userActivityRoutes");
const { savePageView } = require("./controllers/admin/userActivityController");
const { downloadBackup, listCollections, downloadCollection, downloadMongodump, triggerS3Backup, listS3Backups } = require("./controllers/admin/backupController");
// backupScheduler exports runBackup and listBackups — scheduling is handled externally via cron-job.org
const apiLoggerMiddleware = require("./middlewares/apiLogger");
const { runActivationReminderJob } = require("./utils/activationReminderJob");
// const chatAgentRoutes = require("./routes/chatAgentRoutes");
// const initGraphQL = require("./graphql");

app.use(cors());

// ── Webhooks that need their own body parsing — register BEFORE express.json() ──

// Stripe: raw body for signature verification
app.post(
  "/billing/webhook",
  express.raw({ type: "application/json" }),
  require("./controllers/billingController").handleStripeWebhook
);

// SNS: sends Content-Type text/plain with a JSON body
const sesWebhookRoutes = require("./routes/sesWebhookRoutes");
app.use("/ses-webhook", sesWebhookRoutes);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(apiLoggerMiddleware);

app.use(express.static(path.resolve("./public")));
app.use("/user", userRoutes);
app.use("/auth", authUnlockRoutes); // account unlock via magic link (no auth — token is the auth)
// app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));
// ✅ NOW mount GraphQL

// initGraphQL(app, checkForAuthentication);
app.use("/api/yeastar", express.json(), yeastarRoutes);
app.use(
  "/api/yeastar-login",
  express.json(),
  checkForAuthentication(),
  yeastarLoginRoutes
);
app.use("/api/script", scriptRoutes); // script generation (auth)
app.use("/voycell_callback", callmeServeRoute); // serves callme.js (no auth)
// app.use("/voyCell_form_call", callmeServerFormCallRoutes); // serves form_call.js (no auth)
app.use("/call", checkForAuthentication(), getExtensionCallHistory);
// app.use(
//   "/integrations/token",
//   checkForAuthentication(),
//   getYeasterValidAccessTokenRoutes
// );
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
app.use("/dashboard", checkForAuthentication(), dashboardStatsRoutes);
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
app.use("/api/hubspot", hubspotAuthRoutes);
app.use("/api/pipedrive", pipedriveAuthRoutes);
// app.use("/api/pipedrive", pipedriveRoutes);
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
  "/admin",
  superAdminDashboardRoutes
);
app.use(
  "/admin/help-support",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  adminHelpSupportRoutes
);
app.use(
  "/admin/system-email-templates",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  systemEmailRoutes
);
app.use(
  "/admin/activation-email-config",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  activationEmailConfigRoutes
);

// AI proxy — generate-content requires superadmin; transcribe-and-summarize requires any authenticated user
app.use("/ai", checkForAuthentication(), aiRoutes);

app.use(
  "/superAdmin",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  superadmin
);

// Plan & coupon management (superAdmin only)
app.use(
  "/superAdmin/plans",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  planAdminRoutes
);
app.use(
  "/superAdmin/coupons",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  couponAdminRoutes
);
app.use(
  "/superAdmin/settings",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  globalSettingsAdminRoutes
);
app.use(
  "/superAdmin/api-logs",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  apiLogsRoutes
);
app.use(
  "/superAdmin/user-sessions",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  userSessionsRoutes
);
// Any logged-in user records their own session on login
app.post("/user-session/save", checkForAuthentication(), saveUserSession);
// Any logged-in user records page views
app.post("/user-activity/pageview", checkForAuthentication(), savePageView);
app.use(
  "/superAdmin/user-activity",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  userActivityRoutes
);

// Database backup (superAdmin only)
app.get("/superAdmin/backup/download",           checkForAuthentication(), checkRole(["superadmin"]), downloadBackup);
app.get("/superAdmin/backup/mongodump",          checkForAuthentication(), checkRole(["superadmin"]), downloadMongodump);
app.get("/superAdmin/backup/collections",        checkForAuthentication(), checkRole(["superadmin"]), listCollections);
app.get("/superAdmin/backup/collection/:name",   checkForAuthentication(), checkRole(["superadmin"]), downloadCollection);
// S3 cloud backups (superAdmin dashboard)
app.post("/superAdmin/backup/s3",               checkForAuthentication(), checkRole(["superadmin"]), triggerS3Backup);
app.get("/superAdmin/backup/s3",                checkForAuthentication(), checkRole(["superadmin"]), listS3Backups);

// Activation reminder job — also callable externally via cron-job.org
app.post("/cron/activation-reminders", async (req, res) => {
  const secret = req.headers["x-cron-secret"];
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  try {
    const result = await runActivationReminderJob();
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Automated backup trigger — called by external cron (cron-job.org every 2h).
// Protected by BACKUP_CRON_SECRET header instead of JWT.
app.post("/cron/backup", (req, res, next) => {
  const secret = req.headers["x-backup-secret"];
  if (!secret || secret !== process.env.BACKUP_CRON_SECRET) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
}, triggerS3Backup);

// Live billing — pre-call check, per-minute deduction, call-ended (companyAdmin + agents)
// Must be registered BEFORE the companyAdmin-only /billing block so agents are not
// blocked by the checkRole(["companyAdmin"]) guard below.
app.use("/billing", liveBillingRoutes);

// Credits — accessible by companyAdmin (and agents can view balance)
app.use("/billing/credits", creditsRoutes);

// Billing & subscription (companyAdmin only)
app.use(
  "/billing",
  checkForAuthentication(),
  checkRole(["companyAdmin"]),
  billingRoutes
);

// DIDLogic — phone numbers & calling (companyAdmin + agents)
app.use("/didlogic", checkForAuthentication(), didlogicRoutes);

// DIDLogic — live number inventory (countries → regions → cities → numbers → purchase)
app.use("/didlogic/inventory", checkForAuthentication(), numberInventoryRoutes);

// DIDLogic — KYC document management (no phone numbers required)
app.use("/didlogic/kyc", checkForAuthentication(), kycDocumentRoutes);

// DIDLogic — Number cart (add to cart, remove, clear, purchase)
app.use("/didlogic/cart", checkForAuthentication(), numberCartRoutes);

// Call Rates — superadmin manages, all authenticated users can read
app.use("/call-rates", callRateRoutes);

// DIDLogic admin — margin & API settings (superAdmin only)
app.use(
  "/superAdmin/didlogic",
  checkForAuthentication(),
  checkRole(["superadmin"]),
  didlogicAdminRoutes
);

// Power Dialer — lists, campaigns, sessions, live monitoring
app.use("/api/power-dialer", checkForAuthentication(), powerDialerRoutes);

app.use(
  "/notifications",
  checkForAuthentication(),
  checkAccountStatus,
  notificationRoutes
);


app.use("/check", (req, res) => {
  res.json({ message: "API checkPage" });
});
app.use("/", (req, res) => {
  const timestamp = new Date().toISOString();
  res.json({ message: "API Homepage" });
});

// ------------------- DB CONNECT -------------------
let cachedConnection = null;


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
    await loadConfigPromise;
    await connectToDatabase();

    // ✅ Local/dev mode: Start HTTP server (ONLY if NOT on AWS)
    const IS_AWS = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (!IS_AWS && process.env.NODE_ENV !== "serverless") {

      const PORT = process.env.PORT || 4004;
      app.listen(PORT, () =>
        console.log(
          `🚀 Server running on http://localhost:${PORT}`,
          "env",
          process.env.NODE_ENV
        )
      );

      // Backup scheduling is handled by cron-job.org calling POST /cron/backup every 2 hours
      // Activation reminders triggered by AWS EventBridge → Lambda (voycell-daily-cron)
    }
  } catch (err) {
    console.error("Startup Error:", err);
  }
})();

const connectToDatabase = async () => {
  // Check if connection exists AND is actually working
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  try {
    // Close any stale connections
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }

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
    return connection;
  } catch (err) {
    cachedConnection = null;
    throw err;
  }
};


// ------------------- SERVERLESS EXPORT (HTTP) -------------------
// module.exports.handler = serverless(async (event, context) => {
//   // CRITICAL: Prevent Lambda from waiting for connections to close
//   context.callbackWaitsForEmptyEventLoop = false;

//   try {
//     await connectToDatabase();
//     return app(event, context);
//   } catch (error) {
//     console.error("Lambda handler error:", error);
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ error: "Internal server error" }),
//     };
//   }
// });

const serverlessHandler = serverless(app);

module.exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    await loadSSMPromise;
    await connectToDatabase();

    /* ================================
       1️⃣ HANDLE SCHEDULER EVENT
    ================================= */

    if (event?.type === "SEND_SCHEDULED_CAMPAIGN") {

      const {
        campaignId,
        userId,
        templateId,
        params,
        groupName,
      } = event;

      // Call send logic
      const { sendScheduledCampaignService } =
        require("./services/sendScheduledCampaignService");

      await sendScheduledCampaignService({
        campaignId,
        userId,
        templateId,
        params,
        groupName,
      });

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: "Scheduled campaign sent",
        }),
      };
    }

    /* ================================
       2️⃣ SEND EMAIL BATCH
    ================================= */
    if (event?.type === "SEND_EMAIL_BATCH") {
      const { jobId, batchIndex } = event;
      const { sendEmailBatchService } = require("./services/emailBatchService");
      await sendEmailBatchService({ jobId, batchIndex });
      return { statusCode: 200, body: JSON.stringify({ success: true, message: `Batch ${batchIndex} of job ${jobId} processed` }) };
    }

    /* ================================
       3️⃣ EVENTBRIDGE BACKUP
    ================================= */
    if (event?.type === "DB_BACKUP") {
      const { runBackup } = require("./utils/backupScheduler");
      const result = await runBackup();
      console.log("[EventBridge] DB_BACKUP completed:", result);
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    /* ================================
       3️⃣ NORMAL API REQUEST
    ================================= */

    return serverlessHandler(event, context);

  } catch (error) {
    console.error("Lambda handler error:", error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};


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




// require("dotenv").config();
// // super admin email password
// // email : superadmin@example.com
// // password : SuperSecure123
// const express = require("express");
// const app = express();
// const cors = require("cors");
// const fs = require("fs");
// const path = require("path");
// const { execFile } = require("child_process");
// const multer = require("multer");
// const { fetchConfigFromS3, loadConfigPromise, getConfig } = require("./utils/getConfig");
// const storage = multer.memoryStorage();
// const upload = multer({ storage });


// const mongoose = require("mongoose");
// const serverless = require("serverless-http");

// const { checkForAuthentication } = require("./middlewares/authentication");
// const checkAccountStatus = require("./middlewares/checkAccountStatus");
// const checkRole = require("./middlewares/roleCheck");
// const { error } = require("console");
// const PORT = process.env.PORT || 3003;
// const userRoutes = require("./routes/companyAdminAuthRoutes");
// const yeastarRoutes = require("./routes/yeastarRoutes");
// ////for linkux web UI login signature
// const deleteTemplateRoutes = require("./routes/deleteTemplateRoutes");
// const sendEmail = require("./routes/sendEmailRoutes");
// const whatsappEmailActivityRoutes = require("./routes/whatsappEmailActivityRoutes");


// const yeastarLoginRoutes = require("./routes/yeastarLoginRoutes");
// const scriptRoutes = require("./routes/scriptRoutes");
// const callmeServeRoute = require("./routes/callmeServeRoute");
// const callmeServerFormCallRoutes = require("./routes/callmeServerFormCallRoutes");
// const getExtensionCallHistory = require("./routes/getYeasterCallHistoryRoutes");
// const getYeasterValidAccessTokenRoutes = require("./routes/getValidAccessTokenRoutes");
// const editProfileRoutes = require("./routes/editProfileRoutes");
// const getUserRoutes = require("./routes/getUserRoutes");
// const emailPasswordResetRoutes = require("./routes/emailPasswordResetRoutes");
// const addEditContactLeadsRoutes = require("./routes/addEditContact&LeadsRoutes");
// const getAllContactsOrLeadsRoutes = require("./routes/getAllContactsOrLeadsRoutes");
// const contactAndLeadStatusPiplineRoutes = require("./routes/contactAndLeadStatusPiplineRoutes");
// const addeditTaskRoutes = require("./routes/taskRoutes");
// const getContactActivitiesRoutes = require("./routes/getActivityRoutes");

// const addedittagRoutes = require("./routes/tagRoute");
// const accountConnect = require("./routes/accountConnectRoutes");
// const disconnectAccountRoutes = require("./routes/disconnectAccountRoutes");
// const meetingRoutes = require("./routes/meetingRoutes");
// const hubSpotContactFetchRoutes = require("./routes/hubSpotContactFetchRoutes");
// const zohoContactFetchRoutes = require("./routes/zuhuContactFetchRoutes");
// const zohoAuthRoutes = require("./routes/zohoAuthRoutes");
// // const pipedriveRoutes = require("./routes/pipedriveRoutes");
// const metaRoutes = require("./routes/metaRoutes");
// const faqRoutes = require("./routes/faqRoutes");
// const fetchGoogleContacts = require("./routes/googleContactFatchRoutes");
// const saveBulkContactsRoutes = require("./routes/saveBulkContactsRoutes");
// const helpSupportRoutes = require("./routes/helpSupportRoutes");
// const changePassword = require("./routes/changePasswordRoutes");
// const deleteUserRoutes = require("./routes/deleteUserRoutes");
// const deleteAllTheDataBySuperAdminRoutes = require("./routes/deleteAllTheDataBySuperAdminRoutes");
// const getProfileEventRoutes = require("./routes/getProfileEventRoutes");
// const apiKeyRoutes = require("./routes/apiKeyRoutes");
// const addEditTempleteRoutes = require("./routes/addEditTempleteRoutes");
// const whatsappRoutes = require("./routes/whatsapp.routes");
// const hubspotAuthRoutes = require("./routes/hubspot.routes");
// const pipedriveAuthRoutes = require("./routes/pipedrive.routes");



// //for admin routes
// const getAdminDetailsRoutes = require("./routes/admin/getAdminDetailsRoutes");
// const adminUserRoutes = require("./routes/admin/adminUserRoutes");
// const adminUserVerifyRoutes = require("./routes/admin/userVerifyRoutes");
// const adminHelpSupportRoutes = require("./routes/admin/adminHelpSupportRoutes");
// const superadmin = require("./routes/admin/superAdminRoutes");
// const sendBulkEmailRoutes = require("./routes/admin/sendBulkEmailRoutes");
// // const chatAgentRoutes = require("./routes/chatAgentRoutes");
// // const initGraphQL = require("./graphql");

// app.use(cors());

// app.use(express.json({ limit: "50mb" }));
// app.use(express.urlencoded({ limit: "50mb", extended: true }));

// app.use(express.static(path.resolve("./public")));
// app.use("/user", userRoutes);
// // app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));
// // ✅ NOW mount GraphQL

// // initGraphQL(app, checkForAuthentication);
// app.use("/api/yeastar", express.json(), yeastarRoutes);
// app.use(
//   "/api/yeastar-login",
//   express.json(),
//   checkForAuthentication(),
//   yeastarLoginRoutes
// );
// app.use("/api/script", scriptRoutes); // script generation (auth)
// app.use("/voycell_callback", callmeServeRoute); // serves callme.js (no auth)
// app.use("/voyCell_form_call", callmeServerFormCallRoutes); // serves form_call.js (no auth)
// app.use("/call", checkForAuthentication(), getExtensionCallHistory);
// app.use(
//   "/integrations/token",
//   checkForAuthentication(),
//   getYeasterValidAccessTokenRoutes
// );
// app.use(
//   "/editProfile",
//   checkForAuthentication(),
//   upload.single("profileImage"),
//   editProfileRoutes
// );
// app.use("/sendEmail", checkForAuthentication(), sendEmail);
// app.use("/api/meta", metaRoutes);
// app.use("/getUser", checkForAuthentication(), getUserRoutes);
// app.use("/changePassword", checkForAuthentication(), changePassword);
// app.use("/deleteUser", checkForAuthentication(), deleteUserRoutes);
// app.use("/deleteAllUserData", checkForAuthentication(), checkRole(["superadmin"]), deleteAllTheDataBySuperAdminRoutes);
// app.use("/deleteTemplate", checkForAuthentication(), deleteTemplateRoutes);
// app.use(
//   "/whatsapp-email-call-activity",
//   checkForAuthentication(),
//   whatsappEmailActivityRoutes
// );
// app.use("/email", emailPasswordResetRoutes);
// app.use(
//   "/addEditContactLeads",
//   checkForAuthentication(),
//   addEditContactLeadsRoutes
// );
// app.use(
//   "/getAllContactsOrLeads",
//   checkForAuthentication(),
//   getAllContactsOrLeadsRoutes
// );
// app.use(
//   "/getContactActivities",
//   checkForAuthentication(),
//   getContactActivitiesRoutes
// );
// app.use(
//   "/contactAndLeadStatusPipline",
//   checkForAuthentication(),
//   contactAndLeadStatusPiplineRoutes
// );
// app.use("/task", checkForAuthentication(), addeditTaskRoutes);
// app.use("/tag", checkForAuthentication(), addedittagRoutes);
// app.use("/meeting", checkForAuthentication(), meetingRoutes);
// app.use("/getProfileEvent", checkForAuthentication(), getProfileEventRoutes);
// app.use("/addEditTemplete", checkForAuthentication(), addEditTempleteRoutes);
// app.use("/faq", checkForAuthentication(), faqRoutes);
// // app.use("/chatAgent", checkForAuthentication(), chatAgentRoutes);

// app.use("/api/whatsapp", whatsappRoutes);

// app.use(
//   "/help-support",
//   checkForAuthentication(),
//   upload.single("helpAndSupportAttachments"),
//   helpSupportRoutes
// );
// app.use(
//   "/connect",
//   (req, res, next) => {
//     const skipAuthPaths = ["/google-callback", "/microsoft-callback", "/zoom-callback"];
//     if (skipAuthPaths.includes(req.path)) {
//       return next(); // No token required for callback
//     }
//     return checkForAuthentication()(req, res, next);
//   },
//   accountConnect
// );
// app.use("/disconnect", checkForAuthentication(), disconnectAccountRoutes);
// app.use("/api/zoho", zohoAuthRoutes);
// app.use("/api/hubspot", hubspotAuthRoutes);
// app.use("/api/pipedrive", pipedriveAuthRoutes);
// // app.use("/api/pipedrive", pipedriveRoutes);
// app.use(
//   "/save-bulk-contacts",
//   checkForAuthentication(),
//   saveBulkContactsRoutes
// );
// app.use(
//   "/fetch-google-contacts",
//   (req, res, next) => {
//     const skipAuthPaths = ["/google/callback"];
//     if (skipAuthPaths.includes(req.path)) {
//       return next(); // No token required for callback
//     }
//     return checkForAuthentication()(req, res, next);
//   },
//   fetchGoogleContacts
// );
// app.use(
//   "/fetch-hubspot-contacts",
//   (req, res, next) => {
//     const skipAuthPaths = ["/hubspot/callback"];
//     if (skipAuthPaths.includes(req.path)) {
//       return next(); // No token required for callback
//     }
//     return checkForAuthentication()(req, res, next);
//   },
//   hubSpotContactFetchRoutes
// );

// app.use(
//   "/fetch-zoho-contacts",
//   (req, res, next) => {
//     const skipAuthPaths = ["/zoho/callback"];
//     if (skipAuthPaths.includes(req.path)) {
//       return next(); // No token required for callback
//     }
//     return checkForAuthentication()(req, res, next);
//   },
//   zohoContactFetchRoutes
// );
// app.use("/api-key", checkForAuthentication(), apiKeyRoutes);


// // Admin routes
// app.use("/admin/user/verify", adminUserVerifyRoutes);
// app.use("/send-bulk-email", checkForAuthentication(),
//   checkRole(["superadmin"]),
//   sendBulkEmailRoutes);
// app.use(
//   "/admin/user",
//   checkForAuthentication(),
//   checkRole(["companyAdmin"]),
//   adminUserRoutes
// );
// app.use(
//   "/admin",
//   checkForAuthentication(),
//   checkRole(["superadmin"]),
//   getAdminDetailsRoutes
// );
// app.use(
//   "/admin/help-support",
//   checkForAuthentication(),
//   checkRole(["superadmin"]),
//   adminHelpSupportRoutes
// );

// app.use(
//   "/superAdmin",
//   checkForAuthentication(),
//   checkRole(["superadmin"]),
//   superadmin
// );


// app.use("/check", (req, res) => {
//   res.json({ message: "API checkPage" });
// });
// app.use("/", (req, res) => {
//   const timestamp = new Date().toISOString();
//   res.json({ message: "API Homepage" });
// });

// // ------------------- DB CONNECT -------------------
// let cachedConnection = null;


// const connectToDatabase = async () => {
//   // Check if connection exists AND is actually working
//   if (cachedConnection && mongoose.connection.readyState === 1) {
//     return cachedConnection;
//   }

//   try {
//     // Close any stale connections
//     if (mongoose.connection.readyState !== 0) {
//       await mongoose.connection.close();
//     }

//     // Optimized settings for AWS Lambda
//     const connection = await mongoose.connect(process.env.MONGO_URL, {
//       maxPoolSize: 10, // Lower pool size for Lambda (not 200!)
//       minPoolSize: 1, // Keep it minimal
//       serverSelectionTimeoutMS: 10000, // Increase timeout
//       socketTimeoutMS: 45000, // Socket timeout
//       connectTimeoutMS: 10000, // Connection timeout
//       retryWrites: true,
//       retryReads: true,
//       maxIdleTimeMS: 10000, // Close idle connections faster
//       // Disable buffering - fail fast instead of queuing
//       bufferCommands: false,
//     });

//     cachedConnection = connection;
//     return connection;
//   } catch (err) {
//     cachedConnection = null;
//     throw err;
//   }
// };

// // ------------------- CRITICAL: Context settings -------------------
// // Tell Lambda not to wait for empty event loop
// if (process.env.NODE_ENV === "serverless") {
//   app.use((req, res, next) => {
//     // This is crucial for Lambda
//     if (typeof context !== "undefined") {
//       context.callbackWaitsForEmptyEventLoop = false;
//     }
//     next();
//   });
// }

// // ------------------- SOCKET HANDLER -------------------
// const http = require("http");

// // ------------------- START APP -------------------
// (async () => {
//   try {

//     await loadConfigPromise;
//     await connectToDatabase();

//     // ✅ Local/dev mode: Start HTTP server (ONLY if NOT on AWS)
//     const IS_AWS = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
//     if (!IS_AWS && process.env.NODE_ENV !== "serverless") {

//       const PORT = process.env.PORT || 4004;
//       // const server = http.createServer(app);

//       app.listen(PORT, () =>
//         console.log(
//           `🚀 Server running on http://localhost:${PORT}`,
//           "env",
//           process.env.NODE_ENV
//         )
//       );
//     }
//   } catch (err) {
//     console.error("Startup Error:", err);
//   }
// })();










// // ------------------- SERVERLESS EXPORT (HTTP) -------------------
// // module.exports.handler = serverless(async (event, context) => {
// //   // CRITICAL: Prevent Lambda from waiting for connections to close
// //   context.callbackWaitsForEmptyEventLoop = false;

// //   try {
// //     await connectToDatabase();
// //     return app(event, context);
// //   } catch (error) {
// //     console.error("Lambda handler error:", error);
// //     return {
// //       statusCode: 500,
// //       body: JSON.stringify({ error: "Internal server error" }),
// //     };
// //   }
// // });

// const serverlessHandler = serverless(app);

// module.exports.handler = async (event, context) => {
//   context.callbackWaitsForEmptyEventLoop = false;

//   try {
//     await connectToDatabase();

//     /* ================================
//        1️⃣ HANDLE SCHEDULER EVENT
//     ================================= */

//     if (event?.type === "SEND_SCHEDULED_CAMPAIGN") {

//       const {
//         campaignId,
//         userId,
//         templateId,
//         params,
//         groupName,
//       } = event;

//       // Call send logic
//       const { sendScheduledCampaignService } =
//         require("./services/sendScheduledCampaignService");

//       await sendScheduledCampaignService({
//         campaignId,
//         userId,
//         templateId,
//         params,
//         groupName,
//       });

//       return {
//         statusCode: 200,
//         body: JSON.stringify({
//           success: true,
//           message: "Scheduled campaign sent",
//         }),
//       };
//     }

//     /* ================================
//        2️⃣ NORMAL API REQUEST
//     ================================= */

//     return serverlessHandler(event, context);

//   } catch (error) {
//     console.error("Lambda handler error:", error);

//     return {
//       statusCode: 500,
//       body: JSON.stringify({
//         success: false,
//         error: error.message,
//       }),
//     };
//   }
// };


// const t = {
//   status: "success",
//   message: "company admin fetched",
//   page: 1,
//   limit: 10,
//   totalAdmins: 7,
//   totalPages: 1,
//   data: [
//     {
//       _id: "69032996fc434f4104e3f57b",
//       email: "makvanayash2112@gmail.com",
//       extensionNumber: "3015",
//       sipSecret: "G5iknLPBhHu7",
//       phonenumbers: [{ countryCode: "91", number: "1235466877444" }],
//       createdAt: "2025-10-30T09:02:14.321Z",
//       firstname: "yash",
//       lastname: "makvana",
//     },
//   ],
// };

// const s = {
//   status: "success",
//   message: "admin details fetched",
//   data: {
//     _id: "69032996fc434f4104e3f57b",
//     email: "makvanayash2112@gmail.com",
//     extensionNumber: "3015",
//     sipSecret: "G5iknLPBhHu7",
//     phonenumbers: [
//       {
//         countryCode: "91",
//         number: "1235466877444",
//       },
//     ],
//     createdAt: "2025-10-30T09:02:14.321Z",
//     firstname: "yash",
//     lastname: "makvana",
//   },
// };