const { google } = require("googleapis");
const querystring = require("querystring");
const Contact = require("../models/contactModel"); // ✅ Adjust path as needed
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
  const useTestMode = req.user.stripe_test_mode || false;
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

    // ✅ Fetch user & plan details
    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    // Get current plan from subscription

    // const currentPlan = await getUserCurrentPlan(user, useTestMode);
    // const userPlan = currentPlan ? currentPlan.name.toLowerCase() : "starter"; // default starter
    // const currentContactCount = await Contact.countDocuments({
    //   createdBy: userId,
    // });

    let maxLimit = Infinity;
    // if (userPlan === "free") {
    //   maxLimit = 1000; // free users limited to 1000
    // }

    const connections = response.data.connections || [];

    // Fetch existing contact emails and phones for this user
    const existingContacts = await Contact.find(
      { createdBy: userId },
      "emailaddresses phonenumbers"
    );
    const existingEmails = new Set();
    const existingPhones = new Set();

    for (const contact of existingContacts) {
      for (const email of contact.emailaddresses || []) {
        existingEmails.add(email.toLowerCase());
      }
      // for (const phone of contact.phonenumbers || []) {
      //   existingPhones.add(phone);
      // }
      for (const phone of contact.phonenumbers || []) {
        existingPhones.add(`${phone.countryCode}-${phone.number}`);
      }
    }

    const contactsToInsert = [];

    for (const person of connections) {
      const name = person.names?.[0]?.displayName || "";
      const [firstname = "", ...lastnameParts] = name.split(" ");
      const lastname = lastnameParts.join(" ");

      // const emailList = person.emailAddresses?.map(e => e.value.toLowerCase()) || [];
      // const phoneList = person.phoneNumbers?.map(p => p.value.replace(/\+/g, '')) || []; // ⬅️ Cleaned

      const emailListRaw =
        person.emailAddresses?.map((e) => e.value.toLowerCase()) || [];
      // const phoneListRaw = person.phoneNumbers?.map(p => p.value.replace(/\+/g, '')) || [];

      const emailList = emailListRaw.length > 0 ? [emailListRaw[0]] : [];
      // const phoneList = phoneListRaw.length > 0 ? [phoneListRaw[0]] : [];

      // Convert Google phone numbers to [{ countryCode, number }]
      // const phoneList = (person.phoneNumbers || []).map(p => {
      //   let raw = p.value.trim();

      //   // Extract country code (if starts with +XX) and number
      //   let match = raw.match(/^(\+\d{1,4})?\s*(.*)$/);
      //   let countryCode = match && match[1] ? match[1] : "";
      //   let number = match && match[2] ? match[2].replace(/\s+/g, "") : raw;

      //   return { countryCode, number };
      // });

      const phoneListRaw = (person.phoneNumbers || []).map((p) => {
        let raw = p.value.trim();

        // Use libphonenumber-js to parse
        const parsed = parsePhoneNumberFromString(raw);

        if (parsed) {
          return {
            countryCode: `+${parsed.countryCallingCode}`, // ✅ Always correct, e.g., +91, +1, +44
            number: parsed.nationalNumber, // ✅ Clean national number (without country code)
          };
        } else {
          // fallback: if libphonenumber-js fails
          return {
            countryCode: "",
            number: raw.replace(/\D/g, ""), // keep only digits
          };
        }
      });

      const phoneList = phoneListRaw.length > 0 ? [phoneListRaw[0]] : [];

      // Skip if any email or phone matches existing
      const isDuplicate =
        emailList.some((email) => existingEmails.has(email)) ||
        // phoneList.some(phone => existingPhones.has(phone));
        phoneList.some((phone) =>
          existingPhones.has(`${phone.countryCode}-${phone.number}`)
        );

      if (isDuplicate) continue;

      const _id = new mongoose.Types.ObjectId();

      contactsToInsert.push({
        _id,
        contact_id: _id,
        firstname,
        lastname,
        emailaddresses: emailList,
        phonenumbers: phoneList,
        // emailaddresses: Array.isArray(emailList) ? emailList : (emailList ? [emailList] : []),
        // phonenumbers: Array.isArray(phoneList) ? phoneList : (phoneList ? [phoneList] : []),
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
            type: "contact", // ✅ this is important
            title: "Contact Imported from Google",
            description: `${firstname} ${lastname}`,
          },
        ],
      });
    }

    // let savedContacts = [];
    // if (contactsToInsert.length > 0) {
    //   savedContacts = await Contact.insertMany(contactsToInsert);
    // }

    // ✅ Apply plan rules before saving
    let allowedContacts = contactsToInsert;

    if (currentContactCount >= maxLimit) {
      allowedContacts = []; // already at max
    } else if (currentContactCount + contactsToInsert.length > maxLimit) {
      const remainingSlots = maxLimit - currentContactCount;
      allowedContacts = contactsToInsert.slice(0, remainingSlots); // trim
    }

    let savedContacts = [];
    if (allowedContacts.length > 0) {
      savedContacts = await Contact.insertMany(allowedContacts);
    }

    // return res.json({
    //   status: 'success',
    //   contacts: savedContacts, // ✅ only imported contacts
    // });

    // const resultData = {
    //   status: 'success',
    //   message: 'Google Contacts imported successfully',
    //   contacts: savedContacts, // ✅ only imported contacts
    // };

    const resultData = {
      status: "success",
      message: "Google Contacts imported successfully",
      imported: savedContacts.length,
      skipped: contactsToInsert.length - savedContacts.length,
      totalContacts: currentContactCount + savedContacts.length,
      contacts: savedContacts,
    };

    // return res.send(`
    //     <script>
    //         window.opener.postMessage(${resultData}, '*');
    //         window.close();
    //     </script>
    // `);

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
    // console.error('Google Contact Fetch Error:', error);
    // return res.status(500).json({
    //   status: 'error',
    //   message: 'Failed to fetch Google contacts',
    //   error: error.message,
    // });
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
