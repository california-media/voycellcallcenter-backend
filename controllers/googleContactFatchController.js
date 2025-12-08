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
  console.log("user_id", user_id);

  const params = querystring.stringify({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI3,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: user_id,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return res.json({ status: "success", url: authUrl });
};

// Step 2: Google redirects here with ?code=... and ?state=...
const handleGoogleCallback = async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res
      .status(400)
      .json({ status: "error", message: "Missing authorization code" });
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const peopleService = google.people({ version: "v1", auth: oauth2Client });

    const response = await peopleService.people.connections.list({
      resourceName: "people/me",
      pageSize: 1000,
      personFields: "names,emailAddresses,phoneNumbers",
    });

    const userId = req.query.state || null;
    if (!userId) {
      return res.status(400).json({
        status: "error",
        message: "Missing user ID in state parameter",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    // ------------------------------
    // Build sets of existing emails & phones from Contact AND Lead
    // ------------------------------
    const [contactDocs, leadDocs] = await Promise.all([
      Contact.find({ createdBy: userId }, "emailAddresses phoneNumbers").lean(),
      Lead.find({ createdBy: userId }, "emailAddresses phoneNumbers").lean(),
    ]);

    const existingEmails = new Set();
    const existingPhonesFull = new Set();   // "countryCode-number"
    const existingPhonesOnly = new Set();   // "number" only

    const addFromDoc = (doc) => {
      if (!doc) return;
      for (const e of doc.emailAddresses || []) {
        if (typeof e === "string") existingEmails.add(e.toLowerCase().trim());
      }
      for (const p of doc.phoneNumbers || []) {
        const country = (p.countryCode || "").replace(/^\+/, "").trim();
        const numberOnly = (p.number || "").replace(/\D/g, "");
        if (!numberOnly) continue;
        if (country) existingPhonesFull.add(`${country}-${numberOnly}`);
        existingPhonesOnly.add(numberOnly);
      }
    };

    for (const c of contactDocs) addFromDoc(c);
    for (const l of leadDocs) addFromDoc(l);

    const connections = response.data.connections || [];

    // avoid duplicates within same import
    const importNewPhones = new Set();

    const contactsToInsert = [];

    for (const person of connections) {
      const name = person.names?.[0]?.displayName || "";
      const [firstname = "", ...lastnameParts] = name.split(" ");
      const lastname = lastnameParts.join(" ");

      const emailListRaw =
        (person.emailAddresses || []).map((e) => (e.value || "").toLowerCase().trim());
      const emailList = emailListRaw.length > 0 ? [emailListRaw[0]] : [];

      // parse and normalize phone numbers from Google person
      const phoneListRaw = (person.phoneNumbers || []).map((p) => {
        const raw = (p.value || "").trim();
        const parsed = parsePhoneNumberFromString(raw);

        if (parsed && parsed.nationalNumber) {
          const cc = parsed.countryCallingCode ? String(parsed.countryCallingCode).replace(/^\+/, "") : "";
          const num = String(parsed.nationalNumber).replace(/\D/g, "");
          return { countryCode: cc, number: num };
        } else {
          // fallback: remove non-digits, no country code
          const numOnly = raw.replace(/\D/g, "");
          return { countryCode: "", number: numOnly };
        }
      }).filter(p => p && p.number);

      // const phoneList = phoneListRaw.length > 0 ? [phoneListRaw[0]] : [];

      const phoneList =
        phoneListRaw.length > 0
          ? [
            {
              countryCode: phoneListRaw[0].countryCode || "971", // ✅ DEFAULT ADDED HERE
              number: phoneListRaw[0].number,
            },
          ]
          : [];


      // DUPLICATE CHECKS:
      const isEmailDuplicate = emailList.some((email) => existingEmails.has(email));
      let isPhoneDuplicate = false;

      for (const phone of phoneList) {
        const cc = (phone.countryCode || "").replace(/^\+/, "");
        const num = (phone.number || "").replace(/\D/g, "");
        if (!num) continue;

        if (cc) {
          if (existingPhonesFull.has(`${cc}-${num}`) || importNewPhones.has(`${cc}-${num}`)) {
            isPhoneDuplicate = true;
            break;
          }
        } else {
          if (existingPhonesOnly.has(num) || importNewPhones.has(num)) {
            isPhoneDuplicate = true;
            break;
          }
        }
      }

      if (isEmailDuplicate || isPhoneDuplicate) continue;

      // Add to importNewPhones to prevent duplicates within same batch
      for (const phone of phoneList) {
        const cc = (phone.countryCode || "").replace(/^\+/, "");
        const num = (phone.number || "").replace(/\D/g, "");
        if (!num) continue;
        if (cc) importNewPhones.add(`${cc}-${num}`);
        importNewPhones.add(num);
      }

      const _id = new mongoose.Types.ObjectId();

      contactsToInsert.push({
        _id,
        contact_id: _id,
        firstname,
        lastname,
        emailAddresses: emailList,
        phoneNumbers: phoneList,
        company: "",
        designation: "",
        linkedin: "",
        instagram: "",
        telegram: "",
        twitter: "",
        facebook: "",
        createdBy: userId,
        activities: [
          {
            action: "contact_created",
            type: "contact",
            title: "Contact Imported from Google",
            description: `${firstname} ${lastname}`,
          },
        ],
      });
    } // end for connections

    let savedContacts = [];
    if (contactsToInsert.length > 0) {
      savedContacts = await Contact.insertMany(contactsToInsert);
    }

    const resultData = {
      status: "success",
      message: "Google Contacts imported successfully",
      imported: savedContacts.length,
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
            <div class="success">Google Contact fetch Successfully! You can close this window.</div>
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
                window.opener.postMessage({ status: 'error', message: 'Google contact fetch callback failed', error: '${error.message}' }, '*');
                window.close();
            </script>
        `);
  }
};


module.exports = {
  redirectToGoogle,
  handleGoogleCallback,
};
