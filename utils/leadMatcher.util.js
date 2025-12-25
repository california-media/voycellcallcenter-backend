const Lead = require("../models/leadModel");

exports.findExistingLead = async ({ userId, phone, email }) => {
  if (phone) {
    const lead = await Lead.findOne({
      createdBy: userId,
      phoneNumbers: {
        $elemMatch: {
          countryCode: phone.countryCode,
          number: phone.number,
        },
      },
    });
    if (lead) return lead;
  }

  if (email) {
    return await Lead.findOne({
      createdBy: userId,
      emailAddresses: email,
    });
  }

  return null;
};
