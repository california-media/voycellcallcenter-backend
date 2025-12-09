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
  // - if the logged-in user *is* the company admin (role === 'companyAdmin') -> use their _id
  // - else if logged-in user has createdByWhichCompanyAdmin -> use that id
  // - else fallback to the logged in user only
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
    Contact.find({ createdBy: { $in: allUserIds } }, "phoneNumbers").lean(),
    Lead.find({ createdBy: { $in: allUserIds } }, "phoneNumbers").lean(),
  ]);

  const existingPhones = new Set();

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

  for (const c of contacts || []) {
    for (const p of c.phoneNumbers || []) addPhoneVariants(p);
  }
  for (const l of leads || []) {
    for (const p of l.phoneNumbers || []) addPhoneVariants(p);
  }

  return { existingPhones, addPhoneVariants };
};

const redirectToHubSpot = (req, res) => {
  const scopes = ["crm.objects.contacts.read", "oauth"];
  const user_id = req.user._id;
  const defaultCountryCode = req.query.defaultCountryCode || "971";
  console.log("defaultCountryCode:", defaultCountryCode);
  const params = querystring.stringify({
    client_id: process.env.HUBSPOT_CLIENT_ID,
    redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
    scope: scopes.join(" "),
    state: `${user_id}::${defaultCountryCode}`,
    response_type: "code",
  });

  const url = `https://app.hubspot.com/oauth/authorize?${params}`;
  res.json({ status: "success", url });
};

const handleHubSpotCallback = async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state)
    return res.status(400).json({ status: "error", message: "Missing code" });

  const [userId, defaultCountryCode = "971"] = state.split("::");
  console.log("userId:", userId, "defaultCountryCode:", defaultCountryCode);

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

    const { existingPhones, addPhoneVariants } = await buildGlobalDuplicateSets(
      userId
    );

    const contactsToInsert = [];

    for (const item of contactResponse.data.results || []) {
      const props = item.properties || {};
      const firstname = props.firstname || "";
      const lastname = props.lastname || "";
      const email = props.email ? props.email.toLowerCase() : "";

      const rawPhone = (props.phone || "").replace(/\s+/g, "");

      // ✅ ✅ ✅ NEW GOOGLE-LIKE FIX ✅ ✅ ✅
      if (firstname && /\d/.test(firstname) && !rawPhone) {
        console.log("📞 Number found in firstname, moving to phone");
        rawPhone = String(firstname);
        firstname = "";
      }
      else if (
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(firstname) &&
        !email
      ) {
        console.log("📧 Email found in firstname, moving to email");
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

      if (/*emailDuplicate ||*/ phoneDuplicate) {
        console.log(
          `Skipping duplicate: ${firstname} ${lastname}, phone: ${phoneList[0]?.number}`
        );
        continue;
      }

      // Update existing phone set to prevent duplicates in same session
      for (const p of phoneList) {
        addPhoneVariants(p);
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
      });

      // emailList.forEach(e => existingEmails.add(e));
      phoneList.forEach((p) => addPhoneVariants(p));
    }

    console.log(`\n📊 HubSpot Import Summary:`);
    console.log(
      `Total HubSpot contacts fetched: ${(contactRes.data.results || []).length
      }`
    );
    console.log(
      `Contacts to insert (after deduplication): ${contactsToInsert.length}`
    );

    const savedContacts = await Contact.insertMany(contactsToInsert);
    console.log(`✅ Successfully saved: ${savedContacts.length} contacts`);

    const resultData = {
      status: "success",
      message: "HubSpot Contacts imported successfully",
      contacts: savedContacts,
    };

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>HubSpot Connected</title></head>
      <body style="font-family: Arial; text-align:center; padding: 50px;">
        <div style="color:green;">HubSpot Contact fetch successful! You can close this window.</div>
        <script>
          window.opener.postMessage(${JSON.stringify(resultData)}, '*');
          window.close();
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("HubSpot Error:", error);
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
