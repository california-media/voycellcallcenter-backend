const axios = require("axios");
const querystring = require("querystring");
const mongoose = require("mongoose");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const User = require("../models/userModel");
require("dotenv").config();


/* ================= GLOBAL DUPLICATE SET BUILDER ================= */
const buildGlobalDuplicateSets = async (userId) => {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("User not found");

  const companyAdminId =
    user.role === "companyAdmin"
      ? user._id
      : user.createdByWhichCompanyAdmin || user._id;

  const companyUsers = await User.find({
    $or: [
      { _id: companyAdminId },
      { createdByWhichCompanyAdmin: companyAdminId },
    ],
  }).select("_id").lean();

  const userIds = companyUsers.map((u) => u._id);

  const [contacts, leads] = await Promise.all([
    Contact.find(
      { createdBy: { $in: userIds } },
      "phoneNumbers emailAddresses"
    ).lean(),
    Lead.find(
      { createdBy: { $in: userIds } },
      "phoneNumbers emailAddresses"
    ).lean(),
  ]);

  const existingPhones = new Set();
  const existingEmails = new Set();

  const addPhoneVariants = (p) => {
    if (!p?.number) return;
    const digits = p.number.replace(/\D/g, "");
    const cc = String(p.countryCode || "").replace(/\D/g, "");
    if (!digits) return;

    existingPhones.add(digits);
    if (cc) {
      existingPhones.add(`${cc}${digits}`);
      existingPhones.add(`+${cc}${digits}`);
    }
  };

  const addEmailVariants = (e) => {
    if (e) existingEmails.add(e.toLowerCase().trim());
  };

  [...contacts, ...leads].forEach((doc) => {
    doc.phoneNumbers?.forEach(addPhoneVariants);
    doc.emailAddresses?.forEach(addEmailVariants);
  });

  return { existingPhones, existingEmails, addPhoneVariants, addEmailVariants };
};

/* ================= GLOBAL DUPLICATE CHECK ================= */
const isGlobalDuplicate = ({
  phoneObj,
  email,
  existingPhones,
  existingEmails,
}) => {
  if (email && existingEmails.has(email.toLowerCase())) return true;

  if (phoneObj?.number) {
    const digits = phoneObj.number.replace(/\D/g, "");
    const cc = String(phoneObj.countryCode || "").replace(/\D/g, "");
    const full = cc ? `${cc}${digits}` : digits;

    return (
      existingPhones.has(digits) ||
      existingPhones.has(full) ||
      existingPhones.has(`+${full}`)
    );
  }
  return false;
};

/* ================= STEP 1: REDIRECT ================= */
exports.redirectToZoho = (req, res) => {
  // const { type = "contact", defaultCountryCode = "971" } = req.body; // Removed domain
  const defaultCountryCode = req.query.defaultCountryCode || "971";
  const tags = req.query.tags || "[]"; // 👈 ADD
  const category = req.query.category || "contact"; // 👈 ADD (default)
  const type = category === "lead" ? "lead" : "contact"; // derive type from category
  const userId = req.user._id;
  console.log("defaultCountryCode:", defaultCountryCode);
  console.log("tags:", tags);
  console.log("category:", category);
  const scope = type === "lead"
    ? "ZohoCRM.modules.leads.READ"
    : "ZohoCRM.modules.contacts.READ";

  const params = querystring.stringify({
    scope,
    client_id: process.env.ZOHO_CLIENT_ID,
    response_type: "code",
    access_type: "offline",
    redirect_uri: process.env.ZOHO_REDIRECT_URI2,
    // Note: We removed domain from the state string
    // state: `${userId}::${type}::${defaultCountryCode}`,
    state: Buffer.from(
      JSON.stringify({
        userId: userId,
        defaultCountryCode,
        tags,
        category, // 👈 ADD
        type,
      })
    ).toString("base64"),
  });

  return res.json({
    status: "success",
    // Always start at .com
    url: `https://accounts.zoho.com/oauth/v2/auth?${params}`,
  });
};

/* ================= STEP 2: CALLBACK ================= */
exports.handleZohoCallback = async (req, res) => {
  const { code, state, "accounts-server": accountsServer } = req.query;
  if (!code) return res.status(400).send("Missing code");

  // const [userId, type, defaultCountryCode] = state.split("::");

  const {
    userId,
    defaultCountryCode = "971",
    tags = "[]",
    category = "contact", // 👈 ADD
    type,
  } = JSON.parse(Buffer.from(state, "base64").toString());
  console.log("userId:", userId, "defaultCountryCode:", defaultCountryCode, "tags:", tags, "category:", category);

  try {
    /* ===== TOKEN ===== */
    // 3. USE the dynamic accountsServer for token exchange
    const tokenUrl = `${accountsServer}/oauth/v2/token`;

    const tokenRes = await axios.post(
      tokenUrl,
      querystring.stringify({
        grant_type: "authorization_code",
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: process.env.ZOHO_REDIRECT_URI2,
        code,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    // 4. USE api_domain from the response for the API calls
    // tokenRes.data.api_domain will be something like "https://www.zohoapis.eu"
    const apiBase = tokenRes.data.api_domain;
    const accessToken = tokenRes.data.access_token;

    const zohoUrl = type === "lead"
      ? `${apiBase}/crm/v2/Leads`
      : `${apiBase}/crm/v2/Contacts`;

    const zohoRes = await axios.get(zohoUrl, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    const records = zohoRes.data.data || [];

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

    /* ===== DUPLICATE MEMORY ===== */
    const {
      existingPhones,
      existingEmails,
      addPhoneVariants,
      addEmailVariants,
    } = await buildGlobalDuplicateSets(userId);

    // const Model = type === "lead" ? Lead : Contact;
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


    const baseContactTags = ensuredUserTags.map((t, index) => ({
      tag_id: t.tag_id,
      tag: t.tag,
      emoji: t.emoji,
      globalOrder: t.order,
      order: index, // 👈 per-contact order starts from 0
    }));

    const toInsert = [];

    /* ===== PROCESS ===== */
    for (const z of records) {
      let firstname = z.First_Name || "";
      let lastname = z.Last_Name || "";
      let email = (z.Email || "").toLowerCase().trim();
      let rawPhone = (z.Phone || "").replace(/\D/g, "");

      if (!rawPhone && /\d/.test(firstname)) {
        rawPhone = firstname.replace(/\D/g, "");
        firstname = "";
      }

      let phoneObj = null;
      if (rawPhone) {
        const parsed = parsePhoneNumberFromString(
          rawPhone,
          defaultCountryCode
        );

        phoneObj = {
          countryCode:
            parsed?.countryCallingCode || defaultCountryCode,
          number:
            parsed?.nationalNumber ||
            rawPhone.replace(/^0+/, ""),
        };
      }

      const duplicate = isGlobalDuplicate({
        phoneObj,
        email,
        existingPhones,
        existingEmails,
      });

      if (duplicate) continue;

      const _id = new mongoose.Types.ObjectId();

      toInsert.push({
        _id,
        contact_id: _id,
        firstname,
        lastname,
        emailAddresses: email ? [email] : [],
        phoneNumbers: phoneObj ? [phoneObj] : [],
        createdBy: userId,

        isLead: isLeadImport, // 👈 ADD (true for lead)

        tags: baseContactTags.map(t => ({ ...t })),
        activities: [
          {
            action: isLeadImport ? "lead_created" : "contact_created",
            type: isLeadImport ? "lead" : "contact",
            title: isLeadImport
              ? "Lead Imported from zoho"
              : "Contact Imported from zoho",
            description: `${firstname} ${lastname}`,
          },
        ],
      });

      if (email) addEmailVariants(email);
      if (phoneObj) addPhoneVariants(phoneObj);
    }

    const saved = await TargetModel.insertMany(toInsert);

    console.log(saved);
    // console.log(`📊 Zoho ${type.toUpperCase()} Import Summary:`);


    const resultData = {
      status: "success",
      message: isLeadImport
        ? "Zoho Leads imported successfully"
        : "Zoho Contacts imported successfully",
      totalFetched: records.length,
      totalImported: saved.length,
      contacts: saved,
    };
    console.log("Result Data:", resultData);

    return res.send(`
          <!DOCTYPE html>
          <html>
          <head><title>Zoho Connected</title></head>
          <body style="font-family: Arial; text-align:center; padding: 50px;">
            <div style="color:green;">${resultData.message} ! You can close this window.</div>
            <script>
              window.opener.postMessage(${JSON.stringify(resultData)}, '*');
              window.close();
            </script>
          </body>
          </html>
    `);
  } catch (err) {
    console.error("Zoho Import Error:", err);
    return res.send(`
      <script>
        window.opener.postMessage({ status: "error" }, "*");
        window.close();
      </script>
    `);
  }
};
