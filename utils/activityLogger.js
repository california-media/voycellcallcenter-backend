// const logActivityToContact = async (contactId, activityObj) => {
//     const Contact = require("../models/contactModel");
//     const Lead = require("../models/leadModel");

//     // ✅ Basic validation
//     if (!activityObj || !activityObj.type || !activityObj.action) {
//         console.error("Invalid activity object:", activityObj);
//         return;
//     }

//     try {
//         await Contact.findByIdAndUpdate(contactId, {
//             $push: {
//                 activities: {
//                     action: activityObj.action,
//                     type: activityObj.type,
//                     title: activityObj.title || "",
//                     description: activityObj.description || "",
//                     timestamp: new Date(),
//                 },
//             },
//         });
//     } catch (err) {
//         console.error("Error logging activity to contact:", err.message);
//     }
// };

// module.exports = { logActivityToContact };

const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");

const logActivityToContact = async (category, contactId, activityObj) => {
  if (!activityObj || !activityObj.type || !activityObj.action) {
    console.error("Invalid activity object:", activityObj);
    return;
  }

  try {
    let Model;

    if (category === "lead") Model = Lead;
    else Model = Contact;

    await Model.findByIdAndUpdate(contactId, {
      $push: {
        activities: {
          action: activityObj.action,
          type: activityObj.type,
          title: activityObj.title || "",
          description: activityObj.description || "",
          timestamp: new Date(),
        },
      },
    });
  } catch (err) {
    console.error("Error logging activity:", err.message);
  }
};

module.exports = { logActivityToContact };

