const axios = require('axios');
const querystring = require('querystring');
const Contact = require('../models/contactModel'); // adjust as needed
const Lead = require('../models/leadModel'); // adjust as needed
const mongoose = require('mongoose');
const { parsePhoneNumberFromString } = require("libphonenumber-js");

// Step 1: Redirect to HubSpot OAuth
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

// Step 2: Callback after user authorizes
// const handleHubSpotCallback = async (req, res) => {
//   const { code, state: userId } = req.query;

//   if (!code || !userId) {
//     return res.status(400).json({ status: 'error', message: 'Missing code or state' });
//   }

//   try {
//     // Step 3: Exchange code for tokens
//     const tokenResponse = await axios.post('https://api.hubapi.com/oauth/v1/token', querystring.stringify({
//       grant_type: 'authorization_code',
//       client_id: process.env.HUBSPOT_CLIENT_ID,
//       client_secret: process.env.HUBSPOT_CLIENT_SECRET,
//       redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
//       code,
//     }), {
//       headers: {
//         'Content-Type': 'application/x-www-form-urlencoded',
//       },
//     });

//     const accessToken = tokenResponse.data.access_token;

//     // Step 4: Fetch contacts
//     const contactResponse = await axios.get('https://api.hubapi.com/crm/v3/objects/contacts', {
//       headers: { Authorization: `Bearer ${accessToken}` },
//       params: {
//         limit: 100,
//         properties: 'firstname,lastname,email,phone',
//       },
//     });

//     console.log('HubSpot API raw response:', JSON.stringify(contactResponse.data, null, 2));


//     const existingContacts = await Contact.find({ createdBy: userId }, 'emailaddresses phonenumbers');
//     const existingEmails = new Set();
//     const existingPhones = new Set();

//     for (const contact of existingContacts) {
//       for (const email of contact.emailaddresses || []) existingEmails.add(email.toLowerCase());
//       // for (const phone of contact.phonenumbers || []) existingPhones.add(phone);
//       for (const phone of contact.phonenumbers || []) {
//         const key = (phone.countryCode ? `+${phone.countryCode}` : '') + phone.number;
//         existingPhones.add(key);
//       }

//     }

//     const contactsToInsert = [];

//     for (const item of contactResponse.data.results) {
//       const props = item.properties || {};
//       const firstname = props.firstname || '';
//       const lastname = props.lastname || '';
//       const email = props.email ? props.email.toLowerCase() : '';
//       // const phone = props.phone || '';

//       // const emailList = email ? [email] : [];
//       // const phoneList = phone ? [phone.replace(/\+/g, '')] : [];

//       // const isDuplicate =
//       //   emailList.some(e => existingEmails.has(e)) ||
//       //   phoneList.some(p => existingPhones.has(p));

//       const phone = props.phone.replace(/\s+/g, "") || '';

//       const emailList = email ? [email] : [];

//       let phoneObj = null;
//       if (phone) {
//         try {
//           const parsed = parsePhoneNumberFromString(phone);
//           if (parsed) {
//             phoneObj = {
//               countryCode: parsed.countryCallingCode || '',
//               number: parsed.nationalNumber.replace(/\D/g, "") || '',
//             };
//           } else {
//             // fallback: no country code, just store number
//             phoneObj = {
//               countryCode: '',
//               number: phone.replace(/\D/g, ''),
//             };
//           }
//         } catch (e) {
//           phoneObj = {
//             countryCode: '',
//             number: phone.replace(/\D/g, ''),
//           };
//         }
//       }

//       const phoneList = phoneObj ? [phoneObj] : [];

//       const isDuplicate =
//         emailList.some(e => existingEmails.has(e)) ||
//         phoneList.some(p =>
//           existingPhones.has(
//             (p.countryCode ? `+${p.countryCode}` : '') + p.number
//           )
//         );


//       if (isDuplicate) continue;

//       const _id = new mongoose.Types.ObjectId();
//       contactsToInsert.push({
//         _id,
//         contact_id: _id,
//         firstname,
//         lastname,
//         emailAddresses: emailList,
//         phoneNumbers: phoneList,
//         company: '',
//         designation: '',
//         linkedin: '',
//         instagram: '',
//         telegram: '',
//         twitter: '',
//         facebook: '',
//         createdBy: userId,
//         activities: [{
//           action: 'contact_created',
//           type: 'contact',
//           title: 'Contact Imported from HubSpot',
//           description: `${firstname} ${lastname}`,
//         }],
//       });
//     }

//     const savedContacts = await Contact.insertMany(contactsToInsert);

//     const resultData = {
//       status: 'success',
//       message: 'HubSpot Contacts imported successfully',
//       contacts: savedContacts,
//     };

//     console.log(resultData);


//     return res.send(`
//       <!DOCTYPE html>
//       <html>
//       <head><title>HubSpot Connected</title></head>
//       <body style="font-family: Arial; text-align:center; padding: 50px;">
//         <div style="color:green;">HubSpot Contact fetch successful! You can close this window.</div>
//         <script>
//           window.opener.postMessage(${JSON.stringify(resultData)}, '*');
//           window.close();
//         </script>
//       </body>
//       </html>
//     `);
//   } catch (error) {
//     return res.send(`
//       <script>
//         window.opener.postMessage({ status: 'error', message: 'HubSpot contact fetch failed', error: '${error.message}' }, '*');
//         window.close();
//       </script>
//     `);
//   }
// };

const handleHubSpotCallback = async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.status(400).json({ status: 'error', message: 'Missing code or state' });
  }

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await axios.post(
      'https://api.hubapi.com/oauth/v1/token',
      querystring.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.HUBSPOT_CLIENT_ID,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET,
        redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
        code,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const accessToken = tokenResponse.data.access_token;

    // Fetch contacts from HubSpot (adjust params if you want more fields / paging)
    const contactResponse = await axios.get('https://api.hubapi.com/crm/v3/objects/contacts', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        limit: 100,
        properties: 'firstname,lastname,email,phone',
      },
    });

    console.log('HubSpot API raw response:', JSON.stringify(contactResponse.data, null, 2));

    // -------------------------
    // Build existing emails + phone sets from BOTH Contact and Lead
    // -------------------------
    const [existingContacts, existingLeads] = await Promise.all([
      Contact.find({ createdBy: userId }, 'emailAddresses phoneNumbers').lean(),
      Lead.find({ createdBy: userId }, 'emailAddresses phoneNumbers').lean(),
    ]);

    const existingEmails = new Set();
    const existingPhones = new Set(); // contains both full +CC+number and bare-digit variants

    // helper that accepts stored phone object { countryCode: '91', number: '9876543210' }
    const addPhoneVariants = (phoneObj) => {
      if (!phoneObj || !phoneObj.number) return;
      const digits = String(phoneObj.number).replace(/\D/g, '');
      if (!digits) return;
      if (phoneObj.countryCode) {
        const full = `+${phoneObj.countryCode}${digits}`;
        existingPhones.add(full);
      }
      existingPhones.add(digits); // always add bare national digits
    };

    // Collect from contacts
    for (const c of existingContacts || []) {
      for (const e of (c.emailAddresses || [])) {
        if (e) existingEmails.add(String(e).toLowerCase());
      }
      for (const p of (c.phoneNumbers || [])) {
        addPhoneVariants(p);
      }
    }

    // Collect from leads
    for (const l of existingLeads || []) {
      for (const e of (l.emailAddresses || [])) {
        if (e) existingEmails.add(String(e).toLowerCase());
      }
      for (const p of (l.phoneNumbers || [])) {
        addPhoneVariants(p);
      }
    }

    // -------------------------
    // Process HubSpot results, skipping duplicates
    // -------------------------
    const contactsToInsert = [];

    for (const item of (contactResponse.data.results || [])) {
      const props = item.properties || {};
      const firstname = props.firstname || '';
      const lastname = props.lastname || '';
      const email = props.email ? String(props.email).toLowerCase() : '';

      // RAW phone string from HubSpot (may be undefined)
      const rawPhone = (props.phone || '').toString().replace(/\s+/g, '');

      // parse phone into { countryCode, number } if possible
      let phoneObj = null;
      if (rawPhone) {
        try {
          const parsed = parsePhoneNumberFromString(rawPhone);
          if (parsed) {
            phoneObj = {
              countryCode: parsed.countryCallingCode || '',
              number: parsed.nationalNumber
                ? String(parsed.nationalNumber).replace(/\D/g, '')
                : String(parsed.number || '').replace(/\D/g, ''),
            };
          } else {
            // fallback: store bare digits only
            phoneObj = {
              countryCode: '',
              number: rawPhone.replace(/\D/g, ''),
            };
          }
        } catch (e) {
          // parsing failed -> fallback to bare digits
          phoneObj = {
            countryCode: '',
            number: rawPhone.replace(/\D/g, ''),
          };
        }
      }

      const emailList = email ? [email] : [];
      // const phoneList = phoneObj && phoneObj.number ? [phoneObj] : [];

      // ✅ Apply default country code = 971 if missing
      if (phoneObj && phoneObj.number && !phoneObj.countryCode) {
        phoneObj.countryCode = '971';
      }

      const phoneList = phoneObj && phoneObj.number ? [phoneObj] : [];


      // Check email duplication
      const emailMatchesExisting = emailList.some(e => existingEmails.has(e.toLowerCase()));

      // Build phone variants for incoming and check duplication
      const phoneMatchesExisting = phoneList.some(p => {
        const digits = String(p.number || '').replace(/\D/g, '');
        if (!digits) return false;
        if (p.countryCode) {
          const full = `+${p.countryCode}${digits}`;
          return existingPhones.has(full) || existingPhones.has(digits);
        }
        // incoming has no country code: check bare digits only
        return existingPhones.has(digits);
      });

      const isDuplicate = emailMatchesExisting || phoneMatchesExisting;
      if (isDuplicate) {
        // optional: log which contact skipped for auditing
        console.log('Skipping duplicate HubSpot contact:', { firstname, lastname, email, phoneObj });
        continue;
      }

      // If not duplicate, prepare contact object for insertion
      const _id = new mongoose.Types.ObjectId();
      contactsToInsert.push({
        _id,
        contact_id: _id,
        firstname,
        lastname,
        emailAddresses: emailList,
        phoneNumbers: phoneList,
        company: '',
        designation: '',
        linkedin: '',
        instagram: '',
        telegram: '',
        twitter: '',
        facebook: '',
        createdBy: userId,
        activities: [{
          action: 'contact_created',
          type: 'contact',
          title: 'Contact Imported from HubSpot',
          description: `${firstname} ${lastname}`,
        }],
      });

      // Also add these variants to existingPhones / existingEmails sets so subsequent HubSpot results
      // in the same batch can't create duplicates with each other.
      if (emailList.length) {
        for (const e of emailList) existingEmails.add(e.toLowerCase());
      }
      for (const p of phoneList) {
        addPhoneVariants(p);
      }
    } // end loop over results

    // Insert if we have any new contacts
    let savedContacts = [];
    if (contactsToInsert.length > 0) {
      savedContacts = await Contact.insertMany(contactsToInsert);
    }

    const resultData = {
      status: 'success',
      message: 'HubSpot Contacts imported successfully',
      contacts: savedContacts,
    };

    console.log('Import result:', resultData);

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
    console.error('HubSpot callback error:', error);
    // Return an error message to the opener window (useful when this runs in OAuth popup)
    return res.send(`
      <script>
        window.opener.postMessage({ status: 'error', message: 'HubSpot contact fetch failed', error: ${JSON.stringify(error.message)} }, '*');
        window.close();
      </script>
    `);
  }
};


module.exports = {
  redirectToHubSpot,
  handleHubSpotCallback,
};
