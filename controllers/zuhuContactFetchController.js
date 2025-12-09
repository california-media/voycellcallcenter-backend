const querystring = require("querystring");
const axios = require("axios");
const Contact = require("../models/contactModel"); // adjust as needed
const Lead = require("../models/leadModel"); // adjust as needed
const mongoose = require("mongoose");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const User = require("../models/userModel"); // adjust as needed
require("dotenv").config();

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

const redirectToZoho = (req, res) => {
  const domain = req.body.domain || "com"; // or get from user profile/settings
  const defaultCountryCode = req.query.defaultCountryCode || "971";
  const scopes = ["ZohoCRM.modules.contacts.READ"];
  const userId = req.user._id;
  console.log("defaultCountryCode:", defaultCountryCode);
  // Step 1: Redirect to Zoho OAuth
  const params = querystring.stringify({
    scope: scopes.join(","),
    client_id: process.env.ZOHO_CLIENT_ID,
    response_type: "code",
    access_type: "offline",
    redirect_uri: process.env.ZOHO_REDIRECT_URI,
    state: `${userId}::${domain}::${defaultCountryCode}`, // Include region and default country code in state
  });

  const authUrl = `https://accounts.zoho.${domain}/oauth/v2/auth?${params}`;
  return res.json({ status: "success", url: authUrl });
};

const handleZohoCallback = async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.status(400).json({ status: "error" });

  const stateParts = state.split("::");
  const userId = stateParts[0];
  const domain = stateParts[1] || "com";
  const defaultCountryCode = stateParts[2] || "971";
  console.log(
    "userId:",
    userId,
    "domain:",
    domain,
    "defaultCountryCode:",
    defaultCountryCode
  );

  try {
    const tokenRes = await axios.post(
      `https://accounts.zoho.${domain}/oauth/v2/token`,
      querystring.stringify({
        grant_type: "authorization_code",
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        code,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;

    const contactRes = await axios.get(
      `https://www.zohoapis.${domain}/crm/v2/Contacts`,
      { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } }
    );

    const { existingPhones, existingEmails, addPhoneVariants, addEmailVariants } = await buildGlobalDuplicateSets(
      userId
    );

    const contactsToInsert = [];

    for (const contact of contactRes.data.data || []) {
      const firstname = contact.First_Name || "";
      const lastname = contact.Last_Name || "";
      const email = contact.Email ? contact.Email.toLowerCase() : "";
      const rawPhone = (contact.Phone || "").replace(/\s+/g, "");

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

      // const emailDuplicate = emailList.some(e => existingEmails.has(e));
      // const phoneDuplicate = phoneList.some(p => {
      //     const digits = p.number;
      //     const full = p.countryCode ? `+${p.countryCode}${digits}` : digits;
      //     return existingPhones.has(full) || existingPhones.has(digits);
      // });

      const emailDuplicate = emailList.some((e) => existingEmails.has(e));

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
        console.log(
          `Skipping duplicate: ${firstname} ${lastname}, phone: ${phoneList[0]?.number}`
        );
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
        emailaddresses: emailList,
        phonenumbers: phoneList,
        createdBy: userId,
      });

      emailList.forEach((e) => addEmailVariants(e));
      phoneList.forEach((p) => addPhoneVariants(p));
    }

    console.log(`\n📊 Zoho Import Summary:`);
    console.log(
      `Total Zoho contacts fetched: ${(contactRes.data.data || []).length}`
    );
    console.log(
      `Contacts to insert (after deduplication): ${contactsToInsert.length}`
    );

    const savedContacts = await Contact.insertMany(contactsToInsert);
    console.log(`✅ Successfully saved: ${savedContacts.length} contacts`);

    //         // Step 6: Send response back to frontend
    const resultData = {
      status: "success",
      message: "Zoho Contacts imported successfully",
      contacts: savedContacts,
    };
    console.log("Result Data:", resultData);

    return res.send(`
        <!DOCTYPE html>
          <html>
          <head><title>Zoho contact fetch successfully</title></head>
          <body style="font-family: Arial; text-align:center; padding: 50px;">
            <div style="color:green;">Zoho Contact fetch successful! You can close this window.</div>
            <script>
              window.opener.postMessage(${JSON.stringify(resultData)}, '*');
              window.close();
            </script>
          </body>
          </html>
    `);
  } catch (error) {
    console.error("Zoho Error:", error);
    return res.send(`
      <script>
        window.opener.postMessage({ status: "error", message: "Zoho Import Failed" }, "*");
        window.close();
      </script>
    `);
  }
};

module.exports = {
  redirectToZoho,
  handleZohoCallback,
};
