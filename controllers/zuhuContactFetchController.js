const querystring = require("querystring");
const axios = require("axios");
const Contact = require("../models/contactModel"); // adjust as needed
const mongoose = require("mongoose");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
require("dotenv").config();

const redirectToZoho = (req, res) => {

    const domain = req.body.domain || 'com'; // or get from user profile/settings
    const scopes = [
        'ZohoCRM.modules.contacts.READ'
    ];
    const userId = req.user._id;
    // Step 1: Redirect to Zoho OAuth   
    const params = querystring.stringify({
        scope: scopes.join(','),
        client_id: process.env.ZOHO_CLIENT_ID,
        response_type: 'code',
        access_type: 'offline',
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        state: `${userId}::${domain}` // Include region in state
    });

    const authUrl = `https://accounts.zoho.${domain}/oauth/v2/auth?${params}`;
    return res.json({ status: 'success', url: authUrl });
};


const handleZohoCallback = async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
        return res.status(400).json({ status: 'error', message: 'Missing Zoho auth code' });
    }

    const [userId, domain] = state.split('::'); // 👈 extract region
    let zohoAPIURL = '';
    let zohoAccountsURL = '';


    try {
        // Step 1: Try getting Access Token from all known domains
        const domainsToTry = ['in', 'com', 'eu', 'com.au']; // Extend this list as needed
        let tokenData = null;
        let successfulDomain = null;

        for (const d of domainsToTry) {
            try {
                const tokenRes = await axios.post(
                    `https://accounts.zoho.${d}/oauth/v2/token`,
                    querystring.stringify({
                        grant_type: 'authorization_code',
                        client_id: process.env.ZOHO_CLIENT_ID,
                        client_secret: process.env.ZOHO_CLIENT_SECRET,
                        redirect_uri: process.env.ZOHO_REDIRECT_URI,
                        code
                    }),
                    {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    }
                );

                if (tokenRes.data.access_token) {
                    tokenData = tokenRes.data;
                    successfulDomain = d;
                    console.log(`✅ Successful domain: .${successfulDomain}`);
                    zohoAccountsURL = `https://accounts.zoho.${successfulDomain}`;
                    zohoAPIURL = `https://www.zohoapis.${successfulDomain}`;
                    break;
                }
            } catch (err) {
                console.log(`Failed token fetch for .${d} domain:`, err.response?.data || err.message);
            }
        }

        if (!tokenData || !tokenData.access_token) {
            return res.status(400).json({
                status: 'error',
                message: 'Access token not received from Zoho',
                details: tokenData
            });
        }


        // Step 2: Use token to fetch Zoho contacts
        const contactRes = await axios.get(`${zohoAPIURL}/crm/v2/Contacts`, {
            headers: {
                Authorization: `Zoho-oauthtoken ${tokenData.access_token}`,
            },
        });

        const contacts = contactRes.data.data || [];

        // Step 3: Fetch existing contacts (to avoid duplicates)
        const existingContacts = await Contact.find({ createdBy: userId }, 'emailaddresses phonenumbers');
        const existingEmails = new Set();
        const existingPhones = new Set();

        for (const contact of existingContacts) {
            for (const email of contact.emailaddresses || []) {
                existingEmails.add(email.toLowerCase());
            }
            // for (const phone of contact.phonenumbers || []) {
            //     existingPhones.add(phone);
            // }
            for (const phone of contact.phonenumbers || []) {
                if (phone.countryCode && phone.number) {
                    existingPhones.add(`${phone.countryCode}-${phone.number}`);
                }
            }

        }

        // Step 4: Format and filter contacts
        const contactsToInsert = [];

        for (const contact of contacts) {
            const firstName = contact.First_Name || '';
            const lastName = contact.Last_Name || '';
            const email = contact.Email?.toLowerCase();
            // const phone = contact.Phone;
            const rawPhone = contact.Phone;
            // let parsedPhone = null;

            // if (rawPhone) {
            //     try {
            //         const phoneObj = parsePhoneNumberFromString(rawPhone);
            //         if (phoneObj) {
            //             parsedPhone = {
            //                 countryCode: phoneObj.countryCallingCode, // e.g. "1" for US, "91" for India
            //                 number: phoneObj.nationalNumber,          // e.g. "9876543210"
            //             };
            //         }
            //     } catch (e) {
            //         console.log("Phone parse failed:", rawPhone, e.message);
            //     }
            // }

            let parsedPhone = null;

            if (rawPhone) {
                try {
                    const phoneObj = parsePhoneNumberFromString(rawPhone);
                    if (phoneObj) {
                        parsedPhone = {
                            countryCode: phoneObj.countryCallingCode, // e.g. "1"
                            number: phoneObj.nationalNumber,          // e.g. "5555555555"
                        };
                    } else {
                        // ❗ fallback: store raw number if parsing fails
                        parsedPhone = {
                            countryCode: "",
                            number: rawPhone.replace(/[^\d]/g, ""), // keep digits only
                        };
                    }
                } catch (e) {
                    console.log("Phone parse failed:", rawPhone, e.message);
                    parsedPhone = {
                        countryCode: "",
                        number: rawPhone.replace(/[^\d]/g, ""),
                    };
                }
            }


            // Skip if duplicate
            // const isDuplicate =
            //     (email && existingEmails.has(email)) ||
            //     (phone && existingPhones.has(phone));

            let isDuplicate = false;
            if (email && existingEmails.has(email)) {
                isDuplicate = true;
            }
            if (parsedPhone) {
                const phoneKey = `${parsedPhone.countryCode}-${parsedPhone.number}`;
                if (existingPhones.has(phoneKey)) {
                    isDuplicate = true;
                }
            }


            if (isDuplicate) continue;

            const _id = new mongoose.Types.ObjectId();

            contactsToInsert.push({
                _id,
                contact_id: _id,
                firstname: firstName,
                lastname: lastName,
                emailaddresses: email ? [email] : [],
                // phonenumbers: phone ? [phone] : [],
                phonenumbers: parsedPhone ? [parsedPhone] : [],
                company: '',
                designation: '',
                linkedin: '',
                instagram: '',
                telegram: '',
                twitter: '',
                facebook: '',
                createdBy: userId,
                activities: [
                    {
                        action: 'contact_created',
                        type: 'contact',
                        title: 'Contact Imported from Zoho',
                        description: `${firstName} ${lastName}`,
                    }
                ]
            });
        }

        // Step 5: Save new contacts
        let savedContacts = [];
        if (contactsToInsert.length > 0) {
            savedContacts = await Contact.insertMany(contactsToInsert);
        }

        // Step 6: Send response back to frontend
        const resultData = {
            status: 'success',
            message: 'Zoho Contacts imported successfully',
            contacts: savedContacts
        };
        console.log('Result Data:', resultData);

        return res.send(`
      <!DOCTYPE html>
    <html>
    <head>
        <title>Zoho Connected</title>
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
        <div class="success">Zoho Contact fetch Successfully! You can close this window.</div>
         <script>
    (function () {
      const resultData = ${JSON.stringify(resultData)};
      const tryPostMessage = () => {
        try {
          // Use wildcard origin to support cross-origin popup response
          window.opener.postMessage(resultData, '*');

          // Notify success for debug (optional)
          console.log("Message posted to opener.");
        } catch (e) {
          console.error("Failed to postMessage:", e);
        }

        try {
          window.close();
        } catch (e) {
          console.warn("window.close failed. Showing close button.");
        }

        // Fallback UI for browsers blocking close()
        setTimeout(() => {
          document.body.innerHTML = "<h3>Authorization complete.</h3><p>You can close this window.</p>";
        }, 2000);
      };

      // Wait a bit in case opener not ready
      setTimeout(tryPostMessage, 500);
    })();
  </script>

    </body>
    </html>
`);


        //     return res.send(`
        //         <!DOCTYPE html>
        //   <html>
        //   <head><title>Zoho Connected</title></head>
        //   <body style="font-family: Arial; text-align:center; padding: 50px;">
        //     <div style="color:green;">Zoho Contact fetch successful! You can close this window.</div>
        //     <script>
        //       window.opener.postMessage(${JSON.stringify(resultData)}, '*');
        //       window.close();
        //     </script>
        //   </body>
        //   </html>
        //     `);

    } catch (error) {
        console.error('Zoho Import Error:', error.message);
        return res.send(`
            <script>
                window.opener.postMessage({ status: 'error', message: 'Zoho contact fetch failed', error: '${error.message}' }, '*');
                window.close();
            </script>
        `);
    }
};


module.exports = {
    redirectToZoho,
    handleZohoCallback
};
