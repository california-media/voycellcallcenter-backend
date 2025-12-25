const Lead = require("../models/leadModel");
const { normalizePhone } = require("../utils/phone.util");
const { findExistingLead } = require("../utils/leadMatcher.util");

exports.handleMetaLead = async ({ user, payload }) => {
  const fields = payload.fields || {};

  const phone = normalizePhone(fields.phone_number);
  const email = fields.email || null;

  let lead = await findExistingLead({
    userId: user._id,
    phone,
    email,
  });

  if (!lead) {
    lead = await Lead.create({
      firstname: fields.full_name?.split(" ")[0] || "",
      lastname: fields.full_name?.split(" ").slice(1).join(" "),
      company: fields.company_name || "",
      emailAddresses: email ? [email] : [],
      phoneNumbers: phone ? [phone] : [],
      isLead: true,
      status: "contacted",
      createdBy: user._id,
      activities: [
        {
          action: "meta_lead_created",
          type: "lead",
          title: "Meta Lead Created",
          description: "Lead received from Facebook via Pabbly",
        },
      ],
    });

    return { lead, isNew: true };
  }

  // Existing lead
  lead.activities.push({
    action: "meta_lead_duplicate",
    type: "lead",
    title: "Duplicate Meta Lead",
    description: "Existing lead submitted again",
  });

  await lead.save();
  return { lead, isNew: false };
};
