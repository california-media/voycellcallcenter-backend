const axios = require("axios");
const mongoose = require("mongoose");
const User = require("../models/userModel");
const Lead = require("../models/leadModel");
const Contact = require("../models/contactModel");

/**
 * =====================================================
 * HELPER: Load Company Duplicate Data
 * Returns sets of existing emails and phones across company
 * =====================================================
 */
async function loadCompanyDuplicateData(user) {
  // Find company admin
  let companyAdminId = null;
  if (user.role === "companyAdmin") {
    companyAdminId = user._id;
  } else if (user.createdByWhichCompanyAdmin) {
    companyAdminId = user.createdByWhichCompanyAdmin;
  } else {
    companyAdminId = user._id;
  }

  // Get all company users
  const companyUsers = await User.find(
    {
      $or: [
        { _id: companyAdminId },
        { createdByWhichCompanyAdmin: companyAdminId },
      ],
    },
    "_id"
  ).lean();

  const companyUserIds = companyUsers.map((u) => u._id);

  // Load existing leads and contacts
  const [existingLeads, existingContacts] = await Promise.all([
    Lead.find(
      { createdBy: { $in: companyUserIds } },
      "emailAddresses phoneNumbers"
    ).lean(),
    Contact.find(
      { createdBy: { $in: companyUserIds } },
      "emailAddresses phoneNumbers"
    ).lean(),
  ]);

  // Build Sets for fast duplicate checking
  const existingEmails = new Set();
  const existingPhonesFull = new Set();
  const existingPhonesOnly = new Set();

  const addFromDoc = (doc) => {
    // Collect emails
    (doc.emailAddresses || []).forEach((e) => {
      if (e) existingEmails.add(String(e).toLowerCase().trim());
    });

    // Collect phones
    (doc.phoneNumbers || []).forEach((p) => {
      const cc = (p.countryCode || "").replace(/^\+/, "").trim();
      const num = (p.number || "").replace(/\D/g, "");
      if (!num) return;

      if (cc) existingPhonesFull.add(`${cc}-${num}`);
      existingPhonesOnly.add(num);
    });
  };

  existingLeads.forEach(addFromDoc);
  existingContacts.forEach(addFromDoc);

  return {
    existingEmails,
    existingPhonesFull,
    existingPhonesOnly,
  };
}

/**
 * =====================================================
 * STEP 1: Generate Facebook OAuth URL
 * (User must be logged in)
 * =====================================================
 */
exports.connectFacebook = async (req, res) => {
  const userId = req.user._id.toString();
  const redirectUri = process.env.META_REDIRECT_URI;

  const authUrl =
    "https://www.facebook.com/v24.0/dialog/oauth" +
    `?client_id=${process.env.META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${userId}` +
    `&response_type=code` +
    `&scope=pages_manage_metadata,pages_read_engagement,pages_manage_ads,leads_retrieval,pages_show_list`;

  return res.json({ authUrl });
};

/**
 * =====================================================
 * STEP 2: Facebook OAuth Callback
 * (Called by Facebook — NO AUTH HERE)
 * =====================================================
 */
exports.facebookCallback = async (req, res) => {
  try {
    const { code, state: userId } = req.query;
    if (!code || !userId) {
      return res.send(`
        <script>
          window.opener.postMessage(
            { status: 'error', message: 'Invalid callback parameters' },
            '*'
          );
          window.close();
        </script>
      `);
    }

    // Exchange code for access token
    const tokenRes = await axios.get(
      "https://graph.facebook.com/v24.0/oauth/access_token",
      {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: process.env.META_REDIRECT_URI,
          code,
        },
      }
    );

    const { access_token } = tokenRes.data;

    // Fetch user profile
    const profile = await axios.get("https://graph.facebook.com/me", {
      params: { access_token, fields: "id,name" },
    });

    // Update user with Meta connection
    await User.findByIdAndUpdate(userId, {
      $set: {
        "meta.isConnected": true,
        "meta.facebookUserId": profile.data.id,
        "meta.accessToken": access_token,
      },
    });

    const resultData = {
      status: "success",
      message: "Facebook connected successfully",
      userId: profile.data.id,
      userName: profile.data.name,
    };

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
          <title>Facebook Connected</title>
          <style>
              body { 
                  font-family: Arial, sans-serif; 
                  text-align: center; 
                  padding-top: 50px; 
              }
              .success { color: green; font-size: 18px; margin-bottom: 20px; }
          </style>
      </head>
      <body>
          <div class="success">✅ Facebook connected successfully! You can close this window.</div>
          <script>
                  window.opener.postMessage(${JSON.stringify(resultData)}, '*');
              setTimeout(() => window.close(), 2000);
          </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Meta OAuth Error:", err.response?.data || err);
    return res.send(`
      <script>
        window.opener.postMessage(
          { status: 'error', message: 'Facebook connection failed: ${err.message}' },
          '*'
        );
        window.close();
      </script>
    `);
  }
};

/**
 * =====================================================
 * STEP 3: Fetch Lead Forms from User's Pages
 * =====================================================
 */
exports.getFacebookPages = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user?.meta?.accessToken) {
      return res.status(400).json({
        status: "error",
        message: "Meta account not connected",
      });
    }

    // Get all pages the user manages
    const pagesRes = await axios.get(
      "https://graph.facebook.com/v24.0/me/accounts",
      {
        params: {
          access_token: user.meta.accessToken,
          fields: "id,name,access_token",
        },
      }
    );

    const pages = pagesRes.data.data || [];
    const allLeadForms = [];

    // For each page, get all lead forms
    for (const page of pages) {
      try {
        const formsRes = await axios.get(
          `https://graph.facebook.com/v24.0/${page.id}/leadgen_forms`,
          {
            params: {
              access_token: page.access_token,
              fields: "id,name,status,leads_count,page_id",
            },
          }
        );

        const forms = formsRes.data.data || [];
        forms.forEach((form) => {
          allLeadForms.push({
            ...form,
            page_name: page.name,
            page_id: page.id,
            page_access_token: page.access_token,
          });
        });
      } catch (formErr) {
        console.error(
          `Error fetching forms for page ${page.id}:`,
          formErr.message
        );
      }
    }

    return res.json({
      status: "success",
      leadForms: allLeadForms,
      totalForms: allLeadForms.length,
    });
  } catch (err) {
    console.error("Error fetching lead forms:", err.response?.data || err);
    return res.status(500).json({
      status: "error",
      message: "Failed to fetch lead forms",
    });
  }
};

/**
 * =====================================================
 * STEP 4: Subscribe/Unsubscribe Page for Webhook Events
 * =====================================================
 */
exports.subscribeToPage = async (req, res) => {
  try {
    const { pageId, pageName, pageAccessToken, subscribe } = req.body;

    if (!pageId || !pageName || !pageAccessToken) {
      return res.status(400).json({
        status: "error",
        message: "Missing pageId, pageName or pageAccessToken",
      });
    }

    const user = await User.findById(req.user._id);

    if (!user?.meta?.isConnected) {
      return res.status(400).json({
        status: "error",
        message: "Meta account not connected",
      });
    }

    if (subscribe) {
      // Subscribe the page to receive leadgen webhooks
      try {
        console.log(`Subscribing to page ${pageId} for webhooks...`);
        await axios.post(
          `https://graph.facebook.com/v24.0/${pageId}/subscribed_apps`,
          {
            subscribed_fields: "leadgen",
            access_token: pageAccessToken,
          }
        );
        console.log(`✅ Subscribed to page ${pageId} for webhooks`);
      } catch (apiErr) {
        console.error("Facebook API error:", apiErr.response?.data || apiErr);
        return res.status(500).json({
          status: "error",
          message: "Failed to subscribe to Facebook page",
          error: apiErr.response?.data?.error?.message || apiErr.message,
        });
      }

      // Add to user's subscribed pages (if not already there)
      const existingPage = user.meta.subscribedPages?.find(
        (p) => p.pageId === pageId
      );

      if (!existingPage) {
        await User.findByIdAndUpdate(req.user._id, {
          $push: {
            "meta.subscribedPages": {
              pageId,
              pageName,
              pageAccessToken,
              subscribedAt: new Date(),
            },
          },
        });
      }

      return res.json({
        status: "success",
        message: "Successfully subscribed to page",
      });
    } else {
      // Unsubscribe from page
      try {
        // Unsubscribe requires app access token (APP_ID|APP_SECRET)
        const appAccessToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`;

        await axios.delete(
          `https://graph.facebook.com/v24.0/${pageId}/subscribed_apps?access_token=${appAccessToken}`
        );

        console.log(`✅ Unsubscribed from page ${pageId}`);
      } catch (apiErr) {
        console.error("Facebook API error:", apiErr.response?.data || apiErr);
        // Continue to remove from DB even if API call fails
      }

      // Remove from user's subscribed pages
      await User.findByIdAndUpdate(req.user._id, {
        $pull: {
          "meta.subscribedPages": { pageId },
        },
      });

      return res.json({
        status: "success",
        message: "Successfully unsubscribed from page",
      });
    }
  } catch (err) {
    console.error("Error managing page subscription:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to manage page subscription",
      error: err.message,
    });
  }
};

/**
 * =====================================================
 * STEP 5: Import Leads from Selected Form
 * (Directly import without saving - receives form details in request)
 * =====================================================
 */
exports.importExistingLeads = async (req, res) => {
  try {
    const { formId, pageId, pageAccessToken, agentId } = req.body;

    if (!formId || !pageId || !pageAccessToken) {
      return res.status(400).json({
        status: "error",
        message: "Missing formId, pageId or pageAccessToken",
      });
    }

    const user = await User.findById(req.user._id);

    // Determine who will own the imported leads
    let leadOwnerId;
    if (agentId) {
      // Verify agent exists and belongs to this company
      const agent = await User.findById(agentId);
      if (!agent) {
        return res.status(404).json({
          status: "error",
          message: "Agent not found",
        });
      }

      // Verify agent belongs to same company
      const agentCompanyId =
        agent.role === "companyAdmin"
          ? agent._id
          : agent.createdByWhichCompanyAdmin;
      const userCompanyId =
        user.role === "companyAdmin"
          ? user._id
          : user.createdByWhichCompanyAdmin;

      if (
        !agentCompanyId ||
        agentCompanyId.toString() !== userCompanyId.toString()
      ) {
        return res.status(403).json({
          status: "error",
          message: "Agent does not belong to your company",
        });
      }

      leadOwnerId = agentId;
    } else {
      // Import to current user (company admin)
      leadOwnerId = user._id;
    }

    console.log(`Fetching leads from form: ${formId}, owner: ${leadOwnerId}`);

    // ============================================================
    // LOAD COMPANY DUPLICATE DATA
    // ============================================================
    const { existingEmails, existingPhonesFull, existingPhonesOnly } =
      await loadCompanyDuplicateData(user);

    // ============================================================
    // FETCH LEADS FROM SELECTED FORM
    // ============================================================
    let totalImported = 0;
    let totalDuplicates = 0;
    const importBatchPhones = new Set();

    try {
      const leadsRes = await axios.get(
        `https://graph.facebook.com/v24.0/${formId}/leads`,
        {
          params: {
            access_token: pageAccessToken,
            fields: "id,created_time,field_data,ad_id,form_id",
          },
        }
      );

      const leads = leadsRes.data.data || [];
      console.log(`Fetched ${leads.length} leads from form ${formId}`, leads);

      console.log(`Processing ${leads.length} leads from selected form`);

      for (const leadData of leads) {
        const fieldData = leadData.field_data || [];

        // Parse fields
        let firstname = "";
        let lastname = "";
        let email = "";
        let phone = "";
        let company = "";

        fieldData.forEach((field) => {
          const name = field.name.toLowerCase();
          const value = field.values?.[0] || "";

          if (name.includes("first") || name === "name") {
            firstname = value;
          } else if (name.includes("last")) {
            lastname = value;
          } else if (name.includes("full_name")) {
            const parts = value.split(" ");
            firstname = parts[0] || "";
            lastname = parts.slice(1).join(" ") || "";
          } else if (name.includes("email")) {
            email = value.toLowerCase().trim();
          } else if (name.includes("phone")) {
            phone = value.replace(/\D/g, "");
          } else if (name.includes("company")) {
            company = value;
          }
        });

        // Skip empty leads
        if (!firstname && !lastname && !email && !phone) {
          continue;
        }

        // ============================================================
        // DUPLICATE CHECK
        // ============================================================
        let isDuplicate = false;

        // Check email
        if (email && existingEmails.has(email)) {
          isDuplicate = true;
        }

        // Check phone
        if (phone && !isDuplicate) {
          if (existingPhonesOnly.has(phone) || importBatchPhones.has(phone)) {
            isDuplicate = true;
          }
        }

        if (isDuplicate) {
          totalDuplicates++;
          continue;
        }

        // ============================================================
        // CREATE LEAD
        // ============================================================
        const phoneList = phone ? [{ countryCode: "971", number: phone }] : [];
        const emailList = email ? [email] : [];

        // Track in batch
        if (phone) {
          importBatchPhones.add(phone);
          existingPhonesOnly.add(phone);
        }
        if (email) {
          existingEmails.add(email);
        }

        await Lead.create({
          contact_id: new mongoose.Types.ObjectId(),
          firstname: firstname || "",
          lastname: lastname || "",
          company: company || "",
          emailAddresses: emailList,
          phoneNumbers: phoneList,
          isLead: true,
          status: "contacted",
          createdBy: leadOwnerId,
          activities: [
            {
              action: "meta_lead_imported",
              type: "lead",
              title: "Meta Lead Imported",
              description: `Lead imported from Facebook Lead Form ID: ${formId}`,
            },
          ],
        });

        totalImported++;
      }
    } catch (formErr) {
      console.error(`Error fetching leads from form:`, formErr.message);
      return res.status(500).json({
        status: "error",
        message: "Failed to fetch leads from form",
        error: formErr.message,
      });
    }

    return res.json({
      status: "success",
      message:
        totalImported > 0
          ? `Successfully imported ${totalImported} lead(s). ${totalDuplicates} lead(s) were skipped as duplicates already exist in the company.`
          : totalDuplicates > 0
          ? `${totalDuplicates} lead(s) were skipped as duplicates already exist in the company.`
          : "No leads found to import.",
      imported: totalImported,
      duplicates: totalDuplicates,
    });
  } catch (err) {
    console.error("Error importing Meta leads:", err.response?.data || err);
    return res.status(500).json({
      status: "error",
      message: "Failed to import Meta leads",
      error: err.message,
    });
  }
};

/**
 * =====================================================
 * STEP 5: Verify Webhook Endpoint (GET Request)
 * Facebook sends this to verify your endpoint
 * =====================================================
 */
exports.verifyWebhook = (req, res) => {
  const VERIFY_TOKEN =
    process.env.META_WEBHOOK_VERIFY_TOKEN || "your_verify_token_123";

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified successfully!");
    return res.status(200).send(challenge);
  } else {
    console.error("❌ Webhook verification failed");
    return res.sendStatus(403);
  }
};

/**
 * =====================================================
 * STEP 6: Handle Lead Webhook (POST Request)
 * Facebook sends lead data when new lead is created
 * =====================================================
 */
exports.handleLeadWebhook = async (req, res) => {
  try {
    console.log("📨 Received webhook POST request");

    // Respond immediately to Facebook
    res.status(200).send("EVENT_RECEIVED");

    const body = req.body;

    // Check if this is a page webhook
    if (body.object !== "page") {
      console.log("⚠️ Not a page event, object type:", body.object);
      return;
    }

    console.log(
      `✅ Processing page event with ${body.entry?.length || 0} entries`
    );

    // Process each entry
    for (const entry of body.entry || []) {
      // Process each change in the entry
      for (const change of entry.changes || []) {
        // Check if this is a leadgen event
        if (change.field === "leadgen") {
          const leadgenId = change.value.leadgen_id;
          const pageId = change.value.page_id;
          const formId = change.value.form_id;
          const adId = change.value.ad_id;
          const createdTime = change.value.created_time;

          console.log(`📋 New lead received:`);
          console.log(`  Lead ID: ${leadgenId}`);
          console.log(`  Page ID: ${pageId}`);
          console.log(`  Form ID: ${formId}`);
          console.log(`  Ad ID: ${adId}`);

          // Process the lead asynchronously
          processLead(leadgenId, pageId, formId).catch((err) => {
            console.error("Error processing lead:", err);
          });
        }
      }
    }
  } catch (err) {
    console.error("❌ Webhook error:", err);
    // Still return 200 to Facebook to avoid retries
    return res.status(200).send("ERROR");
  }
};

/**
 * =====================================================
 * Helper: Process Individual Lead
 * =====================================================
 */
async function processLead(leadgenId, pageId, formId) {
  try {
    // Find user who has this page in their subscribed pages
    const users = await User.find({
      "meta.subscribedPages.pageId": pageId,
    });

    if (!users || users.length === 0) {
      console.error(`No user found with subscribed pageId: ${pageId}`);
      return;
    }

    // Use the first user found
    const user = users[0];

    // Get the page access token from subscribed pages
    const subscribedPage = user.meta.subscribedPages.find(
      (p) => p.pageId === pageId
    );

    if (!subscribedPage?.pageAccessToken) {
      console.error(`No page access token for pageId: ${pageId}`);
      return;
    }

    const pageAccessToken = subscribedPage.pageAccessToken;
    const leadRes = await axios.get(
      `https://graph.facebook.com/v24.0/${leadgenId}`,
      {
        params: {
          access_token: pageAccessToken,
          fields: "id,created_time,field_data",
        },
      }
    );

    const leadData = leadRes.data;
    console.log(`Fetched lead data for Lead ID: ${leadgenId}`, leadData);
    const fieldData = leadData.field_data || [];

    // Parse fields
    let firstname = "";
    let lastname = "";
    let email = "";
    let phone = "";
    let company = "";

    fieldData.forEach((field) => {
      const name = field.name.toLowerCase();
      const value = field.values?.[0] || "";

      if (name.includes("first") || name === "name") {
        firstname = value;
      } else if (name.includes("last")) {
        lastname = value;
      } else if (name.includes("full_name")) {
        const parts = value.split(" ");
        firstname = parts[0] || "";
        lastname = parts.slice(1).join(" ") || "";
      } else if (name.includes("email")) {
        email = value.toLowerCase().trim();
      } else if (name.includes("phone")) {
        phone = value.replace(/\D/g, "");
      } else if (name.includes("company")) {
        company = value;
      }
    });

    // Skip empty leads
    if (!firstname && !lastname && !email && !phone) {
      console.log("Skipping empty lead");
      return;
    }

    // ============================================================
    // LOAD COMPANY DUPLICATE DATA
    // ============================================================
    const { existingEmails, existingPhonesFull, existingPhonesOnly } =
      await loadCompanyDuplicateData(user);

    // ============================================================
    // DUPLICATE CHECK
    // ============================================================
    let isDuplicate = false;

    // Check email
    if (email && existingEmails.has(email)) {
      isDuplicate = true;
      console.log(`⚠️ Duplicate lead found by email: ${email}`);
    }

    // Check phone
    if (phone && !isDuplicate) {
      if (existingPhonesOnly.has(phone)) {
        isDuplicate = true;
        console.log(`⚠️ Duplicate lead found by phone: ${phone}`);
      }
    }

    if (isDuplicate) {
      console.log(`⚠️ Skipping duplicate lead (Lead ID: ${leadgenId})`);
      return;
    }

    // Create new lead
    const phoneList = phone ? [{ countryCode: "971", number: phone }] : [];
    const emailList = email ? [email] : [];

    const newLead = await Lead.create({
      contact_id: new mongoose.Types.ObjectId(),
      firstname: firstname || "",
      lastname: lastname || "",
      company: company || "",
      emailAddresses: emailList,
      phoneNumbers: phoneList,
      isLead: true,
      status: "contacted",
      createdBy: user._id,
      activities: [
        {
          action: "meta_lead_created",
          type: "lead",
          title: "Meta Lead Created",
          description: `Lead received from Facebook webhook (Form ID: ${formId}, Lead ID: ${leadgenId})`,
        },
      ],
    });

    console.log(`✅ New lead created: ${newLead._id}`);
  } catch (err) {
    console.error(`❌ Error processing lead ${leadgenId}:`);
    throw err;
  }
}

/**
 * =====================================================
 * OLD WEBHOOK (Pabbly - DEPRECATED)
 * =====================================================
 */
exports.metaLeadWebhook = async (req, res) => {
  try {
    console.log(
      "📨 Received Meta lead webhook:",
      JSON.stringify(req.body, null, 2)
    );

    const { pageId, leadData } = req.body;

    if (!pageId || !leadData) {
      console.error("Missing pageId or leadData in webhook");
      return res.status(400).json({
        status: "error",
        message: "Missing required fields",
      });
    }

    // Find user by pageId
    const user = await User.findOne({ "meta.pageId": pageId });
    if (!user) {
      console.error(`No user found for pageId: ${pageId}`);
      return res.status(404).json({
        status: "error",
        message: "User not found for this page",
      });
    }

    // ============================================================
    // FIND COMPANY ADMIN & GET ALL USERS
    // ============================================================
    let companyAdminId = null;
    if (user.role === "companyAdmin") {
      companyAdminId = user._id;
    } else if (user.createdByWhichCompanyAdmin) {
      companyAdminId = user.createdByWhichCompanyAdmin;
    } else {
      companyAdminId = user._id;
    }

    const companyUsers = await User.find(
      {
        $or: [
          { _id: companyAdminId },
          { createdByWhichCompanyAdmin: companyAdminId },
        ],
      },
      "_id"
    ).lean();

    const companyUserIds = companyUsers.map((u) => u._id);

    // Parse lead data from Pabbly
    const { full_name, email, phone_number, company_name } = leadData;

    const nameParts = (full_name || "").split(" ");
    const firstname = nameParts[0] || "";
    const lastname = nameParts.slice(1).join(" ") || "";
    const emailLower = email ? email.toLowerCase().trim() : "";
    const phoneClean = phone_number ? phone_number.replace(/\D/g, "") : "";

    // ============================================================
    // DUPLICATE CHECK ACROSS ALL COMPANY LEADS
    // ============================================================
    let existingLead = null;

    // Check by phone first
    if (phoneClean) {
      existingLead = await Lead.findOne({
        createdBy: { $in: companyUserIds },
        phoneNumbers: {
          $elemMatch: {
            number: phoneClean,
          },
        },
      });
    }

    // Check by email if not found by phone
    if (!existingLead && emailLower) {
      existingLead = await Lead.findOne({
        createdBy: { $in: companyUserIds },
        emailAddresses: emailLower,
      });
    }

    if (existingLead) {
      console.log("⚠️ Duplicate lead found, skipping:", existingLead._id);

      // Add activity to existing lead
      existingLead.activities.push({
        action: "meta_lead_duplicate",
        type: "lead",
        title: "Duplicate Meta Lead",
        description: "Same lead submitted again from Facebook",
      });
      await existingLead.save();

      return res.json({
        status: "duplicate",
        message: "Lead already exists",
        leadId: existingLead._id,
      });
    }

    // ============================================================
    // CREATE NEW LEAD
    // ============================================================
    const phoneList = phoneClean
      ? [{ countryCode: "971", number: phoneClean }]
      : [];
    const emailList = emailLower ? [emailLower] : [];

    const newLead = await Lead.create({
      contact_id: new mongoose.Types.ObjectId(),
      firstname,
      lastname,
      company: company_name || "",
      emailAddresses: emailList,
      phoneNumbers: phoneList,
      isLead: true,
      status: "contacted",
      createdBy: user._id,
      activities: [
        {
          action: "meta_lead_created",
          type: "lead",
          title: "Meta Lead Created",
          description: "Lead received from Facebook via Pabbly webhook",
        },
      ],
    });

    console.log("✅ New Meta lead created:", newLead._id);

    return res.json({
      status: "success",
      message: "Lead created successfully",
      leadId: newLead._id,
    });
  } catch (err) {
    console.error("❌ Error in Meta webhook:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: err.message,
    });
  }
};
