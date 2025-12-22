// const axios = require("axios");
// const Contact = require("../models/contactModel");
// const Lead = require("../models/leadModel");
// const { buildGlobalDuplicateSets } = require("./duplicate.service");

// const fetchModule = async (module, apiBaseUrl, token) => {
//   const res = await axios.get(
//     `${apiBaseUrl}/crm/v2/${module}`,
//     { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
//   );
//   return res.data.data || [];
// };

// exports.syncZoho = async (user) => {
//   const { phones, emails } = await buildGlobalDuplicateSets(user._id);

//   const [contacts, leads, tasks, events] = await Promise.all([
//     fetchModule("Contacts", user.zoho.apiBaseUrl, user.zoho.accessToken),
//     fetchModule("Leads", user.zoho.apiBaseUrl, user.zoho.accessToken),
//     fetchModule("Tasks", user.zoho.apiBaseUrl, user.zoho.accessToken),
//     fetchModule("Events", user.zoho.apiBaseUrl, user.zoho.accessToken)
//   ]);

//   for (const c of contacts) {
//     const phone = c.Phone?.replace(/\D/g, "");
//     const email = c.Email?.toLowerCase();

//     const exists = phones.has(phone) || emails.has(email);

//     if (exists) {
//       await Contact.updateOne(
//         { createdBy: user._id },
//         { $set: { firstname: c.First_Name, lastname: c.Last_Name } }
//       );
//     } else {
//       await Contact.create({
//         firstname: c.First_Name,
//         lastname: c.Last_Name,
//         phoneNumbers: phone ? [{ number: phone }] : [],
//         emailAddresses: email ? [email] : [],
//         createdBy: user._id
//       });
//     }
//   }

//   for (const l of leads) {
//     await Lead.updateOne(
//       { emailAddresses: l.Email?.toLowerCase() },
//       {
//         $setOnInsert: {
//           firstname: l.First_Name,
//           lastname: l.Last_Name,
//           emailAddresses: [l.Email],
//           createdBy: user._id
//         }
//       },
//       { upsert: true }
//     );
//   }

//   // Attach tasks & meetings
//   for (const t of tasks) {
//     await Contact.updateMany(
//       {},
//       { $push: { tasks: { taskDescription: t.Subject } } }
//     );
//   }

//   for (const e of events) {
//     await Contact.updateMany(
//       {},
//       { $push: { meetings: { meetingTitle: e.Event_Title } } }
//     );
//   }
// };


const axios = require("axios");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const { buildGlobalDuplicateSets } = require("./duplicate.service");

const zohoGet = async (url, token) => {
  return axios.get(url, {
    timeout: 15000,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      Accept: "application/json"
    }
  });
};

const fetchModule = async (module, apiBaseUrl, token) => {
  const res = await zohoGet(`${apiBaseUrl}/crm/v2/${module}`, token);
  return res.data?.data || [];
};

const delay = (ms) => new Promise(res => setTimeout(res, ms));

exports.syncZoho = async (user) => {
  const { existingPhones, existingEmails } =
    await buildGlobalDuplicateSets(user._id);

  // ✅ FETCH SEQUENTIALLY (NO Promise.all)
  const contacts = await fetchModule("Contacts", user.zoho.apiBaseUrl, user.zoho.accessToken);
  await delay(800);

  const leads = await fetchModule("Leads", user.zoho.apiBaseUrl, user.zoho.accessToken);
  await delay(800);

  const tasks = await fetchModule("Tasks", user.zoho.apiBaseUrl, user.zoho.accessToken);
  await delay(800);

  const events = await fetchModule("Events", user.zoho.apiBaseUrl, user.zoho.accessToken);

  /* ---------------- CONTACTS ---------------- */
  for (const c of contacts) {
    const phone = c.Phone ? c.Phone.replace(/\D/g, "") : null;
    const email = c.Email ? c.Email.toLowerCase() : null;

    const exists =
      (phone && existingPhones.has(phone)) ||
      (email && existingEmails.has(email));

    if (exists) {
      await Contact.updateOne(
        {
          createdBy: user._id,
          $or: [
            { emailAddresses: email },
            { "phoneNumbers.number": phone }
          ]
        },
        {
          $set: {
            firstname: c.First_Name,
            lastname: c.Last_Name,
            company: c.Account_Name?.name
          }
        }
      );
    } else {
      await Contact.create({
        firstname: c.First_Name,
        lastname: c.Last_Name,
        company: c.Account_Name?.name,
        emailAddresses: email ? [email] : [],
        phoneNumbers: phone ? [{ number: phone }] : [],
        createdBy: user._id
      });
    }
  }

  /* ---------------- LEADS ---------------- */
  for (const l of leads) {
    const email = l.Email?.toLowerCase();
    if (!email) continue;

    await Lead.updateOne(
      { createdBy: user._id, emailAddresses: email },
      {
        $set: {
          firstname: l.First_Name,
          lastname: l.Last_Name,
          company: l.Company
        }
      },
      { upsert: true }
    );
  }

  /* ---------------- TASKS ---------------- */
  for (const t of tasks) {
    if (!t.Who_Id?.id) continue;

    await Contact.updateOne(
      { createdBy: user._id },
      {
        $addToSet: {
          tasks: {
            taskDescription: t.Subject,
            taskDueDate: t.Due_Date
          }
        }
      }
    );
  }

  /* ---------------- EVENTS ---------------- */
  for (const e of events) {
    if (!e.Who_Id?.id) continue;

    await Contact.updateOne(
      { createdBy: user._id },
      {
        $addToSet: {
          meetings: {
            meetingTitle: e.Event_Title,
            meetingStartDate: e.Start_DateTime
          }
        }
      }
    );
  }

  console.log("✅ Zoho sync completed");
};
