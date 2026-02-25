const { google } = require("googleapis");
const querystring = require("querystring");
const Contact = require("../models/contactModel"); // ✅ Adjust path as needed
const Lead = require("../models/leadModel"); // make sure to import
const mongoose = require("mongoose"); // ⬅️ Make sure this is imported at the top
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const { title } = require("process");
const User = require("../models/userModel"); // make sure to import

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI3 // e.g., http://localhost:3000/api/google/callback
);

// Step 1: Generate the Google OAuth Consent URL
const redirectToGoogle = (req, res) => {
  const scopes = ["https://www.googleapis.com/auth/contacts.readonly"];

  const user_id = req.user._id; // Use user ID from request context if available
  const defaultCountryCode = req.query.defaultCountryCode || "971"; // Get from query param or default to 971
  const tags = req.query.tags || "[]"; // 👈 ADD
  const category = req.query.category || "contact"; // 👈 ADD (default)

  const params = querystring.stringify({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI3,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    // state: `${user_id}::${defaultCountryCode}`,
    state: Buffer.from(
      JSON.stringify({
        userId: user_id,
        defaultCountryCode,
        tags,
        category // 👈 ADD
      })
    ).toString("base64"),
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return res.json({ status: "success", url: authUrl });
};

// Step 2: Google redirects here with ?code=... and ?state=...
const handleGoogleCallback = async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res
      .status(400)
      .json({ status: "error", message: "Missing authorization code" });
  }

  try {
    // ✅ Exchange code for token
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const peopleService = google.people({
      version: "v1",
      auth: oauth2Client,
    });

    const response = await peopleService.people.connections.list({
      resourceName: "people/me",
      pageSize: 1000,
      personFields: "names,emailAddresses,phoneNumbers",
    });

    // ✅ Get user from state
    const stateParam = state;
    if (!stateParam) {
      return res.status(400).json({
        status: "error",
        message: "Missing state parameter",
      });
    }

    // const [userId, defaultCountryCode = "971"] = stateParam.split("::");
    const {
      userId,
      defaultCountryCode = "971",
      tags = "[]",
      category = "contact", // 👈 ADD
    } = JSON.parse(Buffer.from(state, "base64").toString());


    // const parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
    let parsedTags = [];

    try {
      parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
      if (!Array.isArray(parsedTags)) parsedTags = [];
    } catch {
      parsedTags = [];
    }
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    const isLeadImport = category === "lead";

    // 🔥 Dynamic target model
    const TargetModel = isLeadImport ? Lead : Contact;


    let nextUserTagOrder =
      user.tags.length > 0
        ? Math.max(...user.tags.map(t => t.order ?? 0)) + 1
        : 0;

    const ensuredUserTags = [];

    for (const tagItem of parsedTags) {
      const tagText = tagItem.tag?.trim();
      const emoji = tagItem.emoji || "🏷️";

      if (!tagText) continue;

      let existingUserTag = user.tags.find(
        t => t.tag.toLowerCase() === tagText.toLowerCase()
      );

      if (!existingUserTag) {
        existingUserTag = {
          tag_id: new mongoose.Types.ObjectId(),
          tag: tagText,
          emoji,
          order: nextUserTagOrder++,
        };

        user.tags.push(existingUserTag);
      }

      ensuredUserTags.push(existingUserTag);
    }

    if (ensuredUserTags.length > 0) {
      await user.save();
    }

    // ============================================================
    // ✅ STEP 1: FIND COMPANY ADMIN
    // ============================================================
    let companyAdminId = null;

    if (user.role === "companyAdmin") {
      companyAdminId = user._id;
    } else if (user.createdByWhichCompanyAdmin) {
      companyAdminId = user.createdByWhichCompanyAdmin;
    } else {
      companyAdminId = user._id; // fallback
    }

    // ============================================================
    // ✅ STEP 2: GET ALL USERS OF THAT COMPANY
    // ============================================================
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


    const baseContactTags = ensuredUserTags.map((t, index) => ({
      tag_id: t.tag_id,
      tag: t.tag,
      emoji: t.emoji,
      globalOrder: t.order,
      order: index, // 👈 per-contact order starts from 0
    }));


    // ============================================================
    // ✅ STEP 3: LOAD ALL CONTACTS & LEADS FOR WHOLE COMPANY
    // ============================================================
    const [contactDocs, leadDocs] = await Promise.all([
      Contact.find(
        { createdBy: { $in: companyUserIds } },
        "emailAddresses phoneNumbers"
      ).lean(),
      Lead.find(
        { createdBy: { $in: companyUserIds } },
        "emailAddresses phoneNumbers"
      ).lean(),
    ]);

    const existingEmails = new Set();
    const existingPhonesFull = new Set(); // countryCode-number
    const existingPhonesOnly = new Set(); // number only

    const addFromDoc = (doc) => {
      for (const e of doc.emailAddresses || []) {
        if (e) existingEmails.add(String(e).toLowerCase().trim());
      }

      for (const p of doc.phoneNumbers || []) {
        const cc = (p.countryCode || "").replace(/^\+/, "").trim();
        const num = (p.number || "").replace(/\D/g, "");
        if (!num) continue;

        if (cc) existingPhonesFull.add(`${cc}-${num}`);
        existingPhonesOnly.add(num);
      }
    };

    contactDocs.forEach(addFromDoc);
    leadDocs.forEach(addFromDoc);

    // ============================================================
    // ✅ STEP 4: IMPORT GOOGLE CONTACTS
    // ============================================================
    const connections = response.data.connections || [];
    const contactsToInsert = [];
    const importNewPhones = new Set(); // avoid duplicate inside same batch
    let count = 0;

    for (const person of connections) {
      const fullName = person.names?.[0]?.displayName || "";
      const [firstname = "", ...lastArr] = fullName.split(" ");
      const lastname = lastArr.join(" ");

      if (firstname && /\d/.test(firstname) && !person.phoneNumbers) {

        person.phoneNumbers = [{ value: firstname }];
      } else if (
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(firstname) &&
        !person.emailAddresses
      ) {
        person.emailAddresses = [{ value: firstname }];
      }

      // ✅ Email
      const emailRaw =
        person.emailAddresses?.[0]?.value?.toLowerCase().trim() || "";
      const emailList = emailRaw ? [emailRaw] : [];

      // ✅ Phone
      let phoneList = [];

      if (person.phoneNumbers?.length) {
        const raw = person.phoneNumbers[0].value || "";
        const parsed = parsePhoneNumberFromString(raw);

        let number = "";
        let countryCode = "";

        if (parsed) {
          number = parsed.nationalNumber;
          countryCode = parsed.countryCallingCode || "";
        } else {
          number = raw.replace(/\D/g, "");
        }

        if (number) {
          number = number.replace(/^0+/, "");
          phoneList.push({
            countryCode: countryCode || defaultCountryCode,
            number,
          });
        }
      }
      // ============================================================
      // ✅ SKIP EMPTY CONTACTS
      // ============================================================
      // Skip if no name, email, or phone
      if (
        !firstname &&
        !lastname &&
        emailList.length === 0 &&
        phoneList.length === 0
      ) {
        continue;
      }

      // ============================================================
      // ✅ STEP 5: DUPLICATE CHECK
      // ============================================================
      let isEmailDuplicate = emailList.some((e) => existingEmails.has(e));

      let isPhoneDuplicate = false;
      for (const phone of phoneList) {
        const cc = phone.countryCode.replace(/^\+/, "");
        const num = phone.number.replace(/\D/g, "");

        if (!num) continue;

        if (
          existingPhonesFull.has(`${cc}-${num}`) ||
          existingPhonesOnly.has(num) ||
          importNewPhones.has(`${cc}-${num}`) ||
          importNewPhones.has(num)
        ) {
          isPhoneDuplicate = true;
          break;
        }
      }

      if (isEmailDuplicate || isPhoneDuplicate) {
        count++;
        continue;
      }

      // ============================================================
      // ✅ STEP 6: PREVENT SAME-BATCH DUPLICATE & UPDATE EXISTING SETS
      // ============================================================
      // Add to same-batch tracking
      for (const phone of phoneList) {
        const cc = phone.countryCode.replace(/^\+/, "");
        const num = phone.number.replace(/\D/g, "");

        importNewPhones.add(`${cc}-${num}`);
        importNewPhones.add(num);
        // Also update the main sets so subsequent imports in same session work
        existingPhonesFull.add(`${cc}-${num}`);
        existingPhonesOnly.add(num);
      }

      // Update email set too
      for (const email of emailList) {
        existingEmails.add(email);
      }

      // ============================================================
      // ✅ STEP 7: INSERT
      // ============================================================
      const _id = new mongoose.Types.ObjectId();

      contactsToInsert.push({
        _id,
        contact_id: _id,
        firstname,
        lastname,
        emailAddresses: emailList,
        phoneNumbers: phoneList,
        createdBy: userId,

        isLead: isLeadImport, // 👈 ADD (true for lead)

        tags: baseContactTags.map(t => ({ ...t })),

        activities: [
          {
            action: isLeadImport ? "lead_created" : "contact_created",
            type: isLeadImport ? "lead" : "contact",
            title: isLeadImport
              ? "Lead Imported from Google"
              : "Contact Imported from Google",
            description: `${firstname} ${lastname}`,
          },
        ],
      });

    }

    // ============================================================
    // ✅ STEP 8: SAVE TO DB
    // ============================================================

    let savedContacts = [];
    if (contactsToInsert.length > 0) {
      // savedContacts = await Contact.insertMany(contactsToInsert);
      savedContacts = await TargetModel.insertMany(contactsToInsert);
    } else {
      console.log(
        `ℹ️  No new contacts to import (all were duplicates or empty)`
      );
    }

    // ============================================================
    // ✅ STEP 9: RETURN RESULT
    // ============================================================
    const resultData = {
      status: "success",
      message: isLeadImport
        ? "Google Leads imported successfully"
        : "Google Contacts imported successfully",
      totalFetched: connections.length,
      totalImported: savedContacts.length,
      contacts: savedContacts,
    };

    return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Google Connected</title>
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
            <div class="success">${resultData.message} ! You can close this window.</div>
            <script>
                window.opener.postMessage(${JSON.stringify(resultData)}, '*');
                window.close();
            </script>
        </body>
        </html>
    `);
  } catch (error) {
    return res.send(`
      <script>
        window.opener.postMessage(
          { status: 'error', message: 'Google contact fetch failed', error: '${error.message}' },
          '*'
        );
        window.close();
      </script>
    `);
  }
};

module.exports = {
  redirectToGoogle,
  handleGoogleCallback,
};
