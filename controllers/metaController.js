const axios = require("axios");
const mongoose = require("mongoose");
const User = require("../models/userModel");
const Lead = require("../models/leadModel");

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
    "https://www.facebook.com/v19.0/dialog/oauth" +
    `?client_id=${process.env.META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${userId}` +
    `&response_type=code` +
    `&scope=ads_management,leads_retrieval,pages_show_list,pages_read_engagement,pages_manage_ads`;
  `&scope=email,public_profile`;

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
      "https://graph.facebook.com/v19.0/oauth/access_token",
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
      "https://graph.facebook.com/v19.0/me/accounts",
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
          `https://graph.facebook.com/v19.0/${page.id}/leadgen_forms`,
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
 * STEP 4: Import Leads from Selected Form
 * (Directly import without saving - receives form details in request)
 * =====================================================
 */
exports.importExistingLeads = async (req, res) => {
  try {
    const { formId, pageId, pageAccessToken } = req.body;

    if (!formId || !pageId || !pageAccessToken) {
      return res.status(400).json({
        status: "error",
        message: "Missing formId, pageId or pageAccessToken",
      });
    }

    const user = await User.findById(req.user._id);

    console.log(`Fetching leads from form: ${formId}`);

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

    // ============================================================
    // LOAD ALL EXISTING LEADS FOR DUPLICATE CHECK
    // ============================================================
    const existingLeads = await Lead.find(
      { createdBy: { $in: companyUserIds } },
      "emailAddresses phoneNumbers"
    ).lean();

    const existingEmails = new Set();
    const existingPhonesFull = new Set();
    const existingPhonesOnly = new Set();

    existingLeads.forEach((lead) => {
      // Collect emails
      (lead.emailAddresses || []).forEach((email) => {
        if (email) existingEmails.add(String(email).toLowerCase().trim());
      });

      // Collect phones
      (lead.phoneNumbers || []).forEach((phone) => {
        const cc = (phone.countryCode || "").replace(/^\+/, "").trim();
        const num = (phone.number || "").replace(/\D/g, "");
        if (!num) return;

        if (cc) existingPhonesFull.add(`${cc}-${num}`);
        existingPhonesOnly.add(num);
      });
    });

    // ============================================================
    // FETCH LEADS FROM SELECTED FORM
    // ============================================================
    let totalImported = 0;
    let totalDuplicates = 0;
    const importBatchPhones = new Set();

    try {
      const leadsRes = await axios.get(
        `https://graph.facebook.com/v19.0/${formId}/leads`,
        {
          params: {
            access_token: pageAccessToken,
            fields: "id,created_time,field_data,ad_id,form_id",
          },
        }
      );

      const leads = leadsRes.data.data || [];

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
          createdBy: user._id,
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
      message: "Meta leads imported successfully",
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
 * STEP 6: Meta Lead Webhook (via Pabbly)
 * (NO AUTH — verified by secret)
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
