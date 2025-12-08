const axios = require('axios');
const querystring = require('querystring');
const Contact = require('../models/contactModel'); // adjust as needed
const Lead = require('../models/leadModel'); // adjust as needed
const mongoose = require('mongoose');
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const User = require('../models/userModel'); // adjust as needed
require('dotenv').config();

// const buildGlobalDuplicateSets = async (userId) => {
//   const loggedInUser = await User.findById(userId).lean();

//   if (!loggedInUser) throw new Error("User not found");

//   let allUserIds = [];

//   // ✅ If company ADMIN → take all users under company
//   if (loggedInUser.companyAdmin) {
//     const companyUsers = await User.find({
//       companyAdmin: loggedInUser.companyAdmin,
//     }).select("_id");

//     allUserIds = companyUsers.map(u => u._id);
//   }
//   // ✅ If AGENT → take all under same companyAdmin
//   else if (loggedInUser.createdBy) {
//     const companyUsers = await User.find({
//       $or: [
//         { _id: loggedInUser.createdBy },
//         { createdBy: loggedInUser.createdBy }
//       ]
//     }).select("_id");

//     allUserIds = companyUsers.map(u => u._id);
//   }
//   // ✅ Fallback → only self
//   else {
//     allUserIds = [userId];
//   }

//   const [contacts, leads] = await Promise.all([
//     Contact.find({ createdBy: { $in: allUserIds } }, "phoneNumbers").lean(),
//     Lead.find({ createdBy: { $in: allUserIds } }, "phoneNumbers").lean()
//   ]);

//   // const existingEmails = new Set();
//   const existingPhones = new Set();

//   const addPhoneVariants = (phoneObj) => {
//     if (!phoneObj || !phoneObj.number) return;
//     const digits = String(phoneObj.number).replace(/\D/g, "");
//     if (!digits) return;
//     if (phoneObj.countryCode) {
//       existingPhones.add(`+${phoneObj.countryCode}${digits}`);
//     }
//     existingPhones.add(digits);
//   };

//   for (const c of contacts) {
//     // for (const e of c.emailAddresses || []) existingEmails.add(e.toLowerCase());
//     for (const p of c.phoneNumbers || []) addPhoneVariants(p);
//   }

//   for (const l of leads) {
//     // for (const e of l.emailAddresses || []) existingEmails.add(e.toLowerCase());
//     for (const p of l.phoneNumbers || []) addPhoneVariants(p);
//   }

//   return { existingPhones, addPhoneVariants };
// };


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
      { createdByWhichCompanyAdmin: companyAdminId }
    ]
  }).select("_id").lean();

  const allUserIds = companyUsers.map(u => u._id);

  const [contacts, leads] = await Promise.all([
    Contact.find({ createdBy: { $in: allUserIds } }, "phoneNumbers").lean(),
    Lead.find({ createdBy: { $in: allUserIds } }, "phoneNumbers").lean()
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
  const scopes = [
    'crm.objects.contacts.read',
    'oauth'
  ];
  const user_id = req.user._id;
  const params = querystring.stringify({
    client_id: process.env.HUBSPOT_CLIENT_ID,
    redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
    scope: scopes.join(' '),
    state: user_id,
    response_type: 'code',
  });

  const url = `https://app.hubspot.com/oauth/authorize?${params}`;
  res.json({ status: 'success', url });
};

const handleHubSpotCallback = async (req, res) => {
  const { code, state: userId } = req.query;
  if (!code || !userId) return res.status(400).json({ status: "error", message: "Missing code" });

  try {
    // ✅ TOKEN
    const tokenResponse = await axios.post(
      "https://api.hubapi.com/oauth/v1/token",
      querystring.stringify({
        grant_type: "authorization_code",
        client_id: process.env.HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET,
        redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
        code
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenResponse.data.access_token;

    // ✅ FETCH CONTACTS
    const contactResponse = await axios.get(
      "https://api.hubapi.com/crm/v3/objects/contacts",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 100, properties: "firstname,lastname,email,phone" }
      }
    );

    const { existingPhones, addPhoneVariants } =
      await buildGlobalDuplicateSets(userId);

    const contactsToInsert = [];

    for (const item of contactResponse.data.results || []) {
      const props = item.properties || {};
      const firstname = props.firstname || "";
      const lastname = props.lastname || "";
      const email = props.email ? props.email.toLowerCase() : "";

      const rawPhone = (props.phone || "").replace(/\s+/g, "");
      let phoneObj = null;

      if (rawPhone) {
        try {
          const parsed = parsePhoneNumberFromString(rawPhone);
          phoneObj = parsed
            ? { countryCode: parsed.countryCallingCode || "", number: parsed.nationalNumber.replace(/\D/g, "").replace(/^0+/, "") }
            : { countryCode: "", number: rawPhone.replace(/\D/g, "").replace(/^0+/, "") };
        } catch {
          phoneObj = { countryCode: "", number: rawPhone.replace(/\D/g, "").replace(/^0+/, "") };
        }
      }

      if (phoneObj && phoneObj.number && !phoneObj.countryCode) phoneObj.countryCode = "971";

      const emailList = email ? [email] : [];
      const phoneList = phoneObj && phoneObj.number ? [phoneObj] : [];

      // const emailDuplicate = emailList.some(e => existingEmails.has(e));
      // const phoneDuplicate = phoneList.some(p => {
      //   const digits = p.number;
      //   const full = p.countryCode ? `+${p.countryCode}${digits}` : digits;
      //   return existingPhones.has(full) || existingPhones.has(digits);
      // });

      const phoneDuplicate = phoneList.some(p => {
        const digits = String(p.number || "").replace(/\D/g, "");
        if (!digits) return false;
        const full = p.countryCode ? `+${String(p.countryCode).replace(/^\+/, "")}${digits}` : digits;
        // check both normalized full (+CCdigits) and bare digits
        return existingPhones.has(full) || existingPhones.has(digits) || existingPhones.has(`${String(p.countryCode).replace(/^\+/, "")}${digits}`);
      });


      if (/*emailDuplicate ||*/ phoneDuplicate) continue;

      const _id = new mongoose.Types.ObjectId();
      contactsToInsert.push({
        _id,
        contact_id: _id,
        firstname,
        lastname,
        emailAddresses: emailList,
        phoneNumbers: phoneList,
        createdBy: userId
      });

      // emailList.forEach(e => existingEmails.add(e));
      phoneList.forEach(p => addPhoneVariants(p));
    }

    const savedContacts = await Contact.insertMany(contactsToInsert);

    const resultData = {
      status: 'success',
      message: 'HubSpot Contacts imported successfully',
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
