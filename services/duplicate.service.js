const User = require("../models/userModel");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");

exports.buildGlobalDuplicateSets = async (userId) => {
  const loggedInUser = await User.findById(userId).lean();
  if (!loggedInUser) throw new Error("User not found");

  let companyAdminId;
  if (loggedInUser.role === "companyAdmin") {
    companyAdminId = loggedInUser._id;
  } else if (loggedInUser.createdByWhichCompanyAdmin) {
    companyAdminId = loggedInUser.createdByWhichCompanyAdmin;
  } else {
    companyAdminId = loggedInUser._id;
  }

  const companyUsers = await User.find({
    $or: [
      { _id: companyAdminId },
      { createdByWhichCompanyAdmin: companyAdminId },
    ],
  }).select("_id").lean();

  const allUserIds = companyUsers.map(u => u._id);

  const [contacts, leads] = await Promise.all([
    Contact.find({ createdBy: { $in: allUserIds } }, "phoneNumbers emailAddresses").lean(),
    Lead.find({ createdBy: { $in: allUserIds } }, "phoneNumbers emailAddresses").lean(),
  ]);

  const existingPhones = new Set();
  const existingEmails = new Set();

  const addPhoneVariants = (phoneObj) => {
    if (!phoneObj?.number) return;
    const digits = String(phoneObj.number).replace(/\D/g, "");
    if (!digits) return;

    if (phoneObj.countryCode) {
      existingPhones.add(`+${phoneObj.countryCode}${digits}`);
      existingPhones.add(`${phoneObj.countryCode}${digits}`);
    }
    existingPhones.add(digits);
  };

  const addEmailVariants = (email) => {
    if (email) existingEmails.add(email.toLowerCase());
  };

  // for (const c of contacts) {
  //   c.phoneNumbers?.forEach(addPhoneVariants);
  //   c.emailAddresses?.forEach(addEmailVariants);
  // }

  // for (const l of leads) {
  //   l.phoneNumbers?.forEach(addPhoneVariants);
  //   // l.emailAddresses?.forEach(addEmailVariants);
  //   if (Array.isArray(l.emailAddresses)) {
  //     l.emailAddresses.forEach(addEmailVariants);
  //   } else if (typeof l.emailAddresses === "string") {
  //     addEmailVariants(l.emailAddresses);
  //   }

  // }

  for (const c of contacts) {
    if (Array.isArray(c.phoneNumbers)) {
      c.phoneNumbers.forEach(addPhoneVariants);
    }

    if (Array.isArray(c.emailAddresses)) {
      c.emailAddresses.forEach(addEmailVariants);
    } else if (typeof c.emailAddresses === "string") {
      addEmailVariants(c.emailAddresses);
    }
  }

  for (const l of leads) {
    if (Array.isArray(l.phoneNumbers)) {
      l.phoneNumbers.forEach(addPhoneVariants);
    }

    if (Array.isArray(l.emailAddresses)) {
      l.emailAddresses.forEach(addEmailVariants);
    } else if (typeof l.emailAddresses === "string") {
      addEmailVariants(l.emailAddresses);
    }
  }


  return { existingPhones, existingEmails, addPhoneVariants, addEmailVariants };
};
