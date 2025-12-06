const axios = require('axios');
const querystring = require('querystring');
const Contact = require('../models/contactModel'); // adjust as needed
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
const handleHubSpotCallback = async (req, res) => {
  const { code, state: userId } = req.query;

  if (!code || !userId) {
    return res.status(400).json({ status: 'error', message: 'Missing code or state' });
  }

  try {
    // Step 3: Exchange code for tokens
    const tokenResponse = await axios.post('https://api.hubapi.com/oauth/v1/token', querystring.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: process.env.HUBSPOT_REDIRECT_URI,
      code,
    }), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const accessToken = tokenResponse.data.access_token;

    // Step 4: Fetch contacts
    const contactResponse = await axios.get('https://api.hubapi.com/crm/v3/objects/contacts', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        limit: 100,
        properties: 'firstname,lastname,email,phone',
      },
    });

    console.log('HubSpot API raw response:', JSON.stringify(contactResponse.data, null, 2));


    const existingContacts = await Contact.find({ createdBy: userId }, 'emailaddresses phonenumbers');
    const existingEmails = new Set();
    const existingPhones = new Set();

    for (const contact of existingContacts) {
      for (const email of contact.emailaddresses || []) existingEmails.add(email.toLowerCase());
      // for (const phone of contact.phonenumbers || []) existingPhones.add(phone);
      for (const phone of contact.phonenumbers || []) {
        const key = (phone.countryCode ? `+${phone.countryCode}` : '') + phone.number;
        existingPhones.add(key);
      }

    }

    const contactsToInsert = [];

    for (const item of contactResponse.data.results) {
      const props = item.properties || {};
      const firstname = props.firstname || '';
      const lastname = props.lastname || '';
      const email = props.email ? props.email.toLowerCase() : '';
      // const phone = props.phone || '';

      // const emailList = email ? [email] : [];
      // const phoneList = phone ? [phone.replace(/\+/g, '')] : [];

      // const isDuplicate =
      //   emailList.some(e => existingEmails.has(e)) ||
      //   phoneList.some(p => existingPhones.has(p));

      const phone = props.phone.replace(/\s+/g, "") || '';

      const emailList = email ? [email] : [];

      let phoneObj = null;
      if (phone) {
        try {
          const parsed = parsePhoneNumberFromString(phone);
          if (parsed) {
            phoneObj = {
              countryCode: parsed.countryCallingCode || '',
              number: parsed.nationalNumber.replace(/\D/g, "") || '',
            };
          } else {
            // fallback: no country code, just store number
            phoneObj = {
              countryCode: '',
              number: phone.replace(/\D/g, ''),
            };
          }
        } catch (e) {
          phoneObj = {
            countryCode: '',
            number: phone.replace(/\D/g, ''),
          };
        }
      }

      const phoneList = phoneObj ? [phoneObj] : [];

      const isDuplicate =
        emailList.some(e => existingEmails.has(e)) ||
        phoneList.some(p =>
          existingPhones.has(
            (p.countryCode ? `+${p.countryCode}` : '') + p.number
          )
        );


      if (isDuplicate) continue;

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
    }

    const savedContacts = await Contact.insertMany(contactsToInsert);

    const resultData = {
      status: 'success',
      message: 'HubSpot Contacts imported successfully',
      contacts: savedContacts,
    };

    console.log(resultData);


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
    return res.send(`
      <script>
        window.opener.postMessage({ status: 'error', message: 'HubSpot contact fetch failed', error: '${error.message}' }, '*');
        window.close();
      </script>
    `);
  }
};

module.exports = {
  redirectToHubSpot,
  handleHubSpotCallback,
};
