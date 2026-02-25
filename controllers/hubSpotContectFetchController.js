const axios = require("axios");
const querystring = require("querystring");
const Contact = require("../models/contactModel"); // adjust as needed
const Lead = require("../models/leadModel"); // adjust as needed
const mongoose = require("mongoose");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const User = require("../models/userModel"); // adjust as needed
require("dotenv").config();

// Step 1: Redirect to HubSpot OAuth

const buildGlobalDuplicateSets = async (userId) => {
  const loggedInUser = await User.findById(userId).lean();
  if (!loggedInUser) throw new Error("User not found");

  // Determine the company admin id:
  let companyAdminId = null;
  if (String(loggedInUser.role) === "companyAdmin") {
    companyAdminId = loggedInUser._id;
  } else if (loggedInUser.createdByWhichCompanyAdmin) {
    companyAdminId = loggedInUser.createdByWhichCompanyAdmin;
  } else {
    companyAdminId = loggedInUser._id;
  }

  // Now fetch the admin + all users that have createdByWhichCompanyAdmin = companyAdminId
  const companyUsers = await User.find({
    $or: [
      { _id: companyAdminId },
      { createdByWhichCompanyAdmin: companyAdminId },
    ],
  })
    .select("_id")
    .lean();

  const allUserIds = companyUsers.map((u) => u._id);

  const [contacts, leads] = await Promise.all([
    Contact.find({ createdBy: { $in: allUserIds } }, "phoneNumbers emailAddresses").lean(),
    Lead.find({ createdBy: { $in: allUserIds } }, "phoneNumbers emailAddresses").lean(),
  ]);

  const existingPhones = new Set();
  const existingEmails = new Set();

  const addPhoneVariants = (phoneObj) => {
    if (!phoneObj || !phoneObj.number) return;
    const digits = String(phoneObj.number).replace(/\D/g, "");
    if (!digits) return;
    if (phoneObj.countryCode) {
      // add both "+CCdigits" and "CC-digits" style safety if you prefer
      existingPhones.add(`+${phoneObj.countryCode}${digits}`);
      existingPhones.add(`${phoneObj.countryCode}${digits}`);
    }
    // always add bare digits
    existingPhones.add(digits);
  };

  const addEmailVariants = (email) => {
    if (!email) return;
    existingEmails.add(email.toLowerCase());
  };

  for (const c of contacts || []) {
    for (const p of c.phoneNumbers || []) addPhoneVariants(p);
    for (const e of c.emailAddresses || []) addEmailVariants(e);
  }
  for (const l of leads || []) {
    for (const p of l.phoneNumbers || []) addPhoneVariants(p);
    for (const e of l.emailAddresses || []) addEmailVariants(e);
  }

  return { existingPhones, existingEmails, addPhoneVariants, addEmailVariants };
};

const redirectToHubSpot = (req, res) => {
  const scopes = ["crm.objects.contacts.read", "oauth"];
  const user_id = req.user._id;
  const defaultCountryCode = req.query.defaultCountryCode || "971";
  const tags = req.query.tags || "[]"; // 👈 ADD
  const category = req.query.category || "contact"; // 👈 ADD (default)
  const params = querystring.stringify({
    client_id: process.env.HUBSPOT_CLIENT_ID,
    redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
    scope: scopes.join(" "),
    // state: `${user_id}::${defaultCountryCode}`,
    state: Buffer.from(
      JSON.stringify({
        userId: user_id,
        defaultCountryCode,
        tags,
        category // 👈 ADD
      })
    ).toString("base64"),
    response_type: "code",
  });

  const url = `https://app.hubspot.com/oauth/authorize?${params}`;
  res.json({ status: "success", url });
};

const handleHubSpotCallback = async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state)
    return res.status(400).json({ status: "error", message: "Missing code" });

  // const [userId, defaultCountryCode = "971"] = state.split("::");
  const {
    userId,
    defaultCountryCode = "971",
    tags = "[]",
    category = "contact", // 👈 ADD
  } = JSON.parse(Buffer.from(state, "base64").toString());

  try {
    // ✅ TOKEN
    const tokenResponse = await axios.post(
      "https://api.hubapi.com/oauth/v1/token",
      querystring.stringify({
        grant_type: "authorization_code",
        client_id: process.env.HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET,
        redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
        code,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenResponse.data.access_token;

    // ✅ FETCH CONTACTS
    const contactResponse = await axios.get(
      "https://api.hubapi.com/crm/v3/objects/contacts",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 100, properties: "firstname,lastname,email,phone" },
      }
    );

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

    const { existingPhones, existingEmails, addPhoneVariants, addEmailVariants } = await buildGlobalDuplicateSets(
      userId
    );

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


    const contactsToInsert = [];

    for (const item of contactResponse.data.results || []) {
      const props = item.properties || {};
      const firstname = props.firstname || "";
      const lastname = props.lastname || "";
      const email = props.email ? props.email.toLowerCase() : "";

      const rawPhone = (props.phone || "").replace(/\s+/g, "");

      // ✅ ✅ ✅ NEW GOOGLE-LIKE FIX ✅ ✅ ✅
      if (firstname && /\d/.test(firstname) && !rawPhone) {
        rawPhone = String(firstname);
        firstname = "";
      } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(firstname) && !email) {
        email = firstname.toLowerCase();
        firstname = "";
      }

      let phoneObj = null;

      if (rawPhone) {
        try {
          const parsed = parsePhoneNumberFromString(rawPhone);
          phoneObj = parsed
            ? {
              countryCode: parsed.countryCallingCode || "",
              number: parsed.nationalNumber
                .replace(/\D/g, "")
                .replace(/^0+/, ""),
            }
            : {
              countryCode: "",
              number: rawPhone.replace(/\D/g, "").replace(/^0+/, ""),
            };
        } catch {
          phoneObj = {
            countryCode: "",
            number: rawPhone.replace(/\D/g, "").replace(/^0+/, ""),
          };
        }
      }

      if (phoneObj && phoneObj.number && !phoneObj.countryCode)
        if (phoneObj && phoneObj.number && !phoneObj.countryCode)
          // ✅ Apply default country code BEFORE duplicate check
          phoneObj.countryCode = defaultCountryCode;

      const emailList = email ? [email] : [];
      const phoneList = phoneObj && phoneObj.number ? [phoneObj] : [];

      // ✅ Skip empty contacts (no name, email, or phone)
      if (
        !firstname &&
        !lastname &&
        emailList.length === 0 &&
        phoneList.length === 0
      ) {
        continue;
      }
      const emailDuplicate = emailList.some((e) => existingEmails.has(e));

      // ✅ Duplicate check AFTER country code is applied
      const phoneDuplicate = phoneList.some((p) => {
        const digits = String(p.number || "").replace(/\D/g, "");
        if (!digits) return false;
        const full = p.countryCode
          ? `+${String(p.countryCode).replace(/^\+/, "")}${digits}`
          : digits;
        // check both normalized full (+CCdigits) and bare digits
        return (
          existingPhones.has(full) ||
          existingPhones.has(digits) ||
          existingPhones.has(
            `${String(p.countryCode).replace(/^\+/, "")}${digits}`
          )
        );
      });

      if (emailDuplicate || phoneDuplicate) {
        continue;
      }

      // Update existing phone set to prevent duplicates in same session
      for (const p of phoneList) {
        addPhoneVariants(p);
      }
      for (const e of emailList) {
        addEmailVariants(e);
      }

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
              ? "Lead Imported from hubSpot"
              : "Contact Imported from hubSpot",
            description: `${firstname} ${lastname}`,
          },
        ],
      });

      // emailList.forEach(e => existingEmails.add(e));
      phoneList.forEach((p) => addPhoneVariants(p));
    }

    const savedContacts = await TargetModel.insertMany(contactsToInsert);

    const resultData = {
      status: "success",
      message: isLeadImport
        ? "HubSpot Leads imported successfully"
        : "HubSpot Contacts imported successfully",
      totalFetched: (contactResponse.data.results || []).length,
      totalImported: savedContacts.length,
      contacts: savedContacts,
    };

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>HubSpot Connected</title></head>
      <body style="font-family: Arial; text-align:center; padding: 50px;">
        <div style="color:green;">${resultData.message} ! You can close this window.</div>
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
        window.opener.postMessage({ status: "error", message: "HubSpot Import Failed" }, "*");
        window.close();
      </script>
    `);
  }
};

module.exports = {
  redirectToHubSpot,
  handleHubSpotCallback,
};
