const Contact = require("../models/contactModel");
const User = require("../models/userModel");
const mongoose = require("mongoose");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const Lead = require("../models/leadModel");

const buildGlobalDuplicateSets = async (userId) => {
  const loggedInUser = await User.findById(userId).lean();
  if (!loggedInUser) throw new Error("User not found");

  // Find companyAdminId using your schema fields
  let companyAdminId = null;
  if (String(loggedInUser.role) === "companyAdmin") {
    companyAdminId = loggedInUser._id;
  } else if (loggedInUser.createdByWhichCompanyAdmin) {
    companyAdminId = loggedInUser.createdByWhichCompanyAdmin;
  } else {
    companyAdminId = loggedInUser._id;
  }

  // Get admin + all users under that admin
  const companyUsers = await User.find({
    $or: [{ _id: companyAdminId }, { createdByWhichCompanyAdmin: companyAdminId }],
  }).select("_id").lean();

  const allUserIds = companyUsers.map((u) => u._id);

  const [contacts, leads] = await Promise.all([
    Contact.find({ createdBy: { $in: allUserIds } }, "emailAddresses phoneNumbers").lean(),
    Lead.find({ createdBy: { $in: allUserIds } }, "emailAddresses phoneNumbers").lean(),
  ]);

  const existingEmails = new Set();
  const existingPhones = new Set();

  const addPhoneVariants = (phoneObj) => {
    if (!phoneObj || !phoneObj.number) return;
    const digits = String(phoneObj.number).replace(/\D/g, "");
    if (!digits) return;
    const cc = phoneObj.countryCode ? String(phoneObj.countryCode).replace(/^\+/, "") : "";
    if (cc) {
      existingPhones.add(`+${cc}${digits}`); // +CC + digits
      existingPhones.add(`${cc}${digits}`); // CCdigits (no +)
    }
    existingPhones.add(digits); // bare digits
  };

  for (const c of contacts || []) {
    for (const e of c.emailAddresses || []) {
      if (e) existingEmails.add(String(e).toLowerCase().trim());
    }
    for (const p of c.phoneNumbers || []) addPhoneVariants(p);
  }

  for (const l of leads || []) {
    for (const e of l.emailAddresses || []) {
      if (e) existingEmails.add(String(e).toLowerCase().trim());
    }
    for (const p of l.phoneNumbers || []) addPhoneVariants(p);
  }

  return { existingEmails, existingPhones, addPhoneVariants, allUserIds };
};

const saveBulkContacts = async (req, res) => {
  try {
    const BATCH_SIZE = 10000; // safe batch size
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized: User not found",
      });
    }
    const { contacts, category = "contact", tags = [], defaultCountryCode = "971" } = req.body;

    let parsedTags = [];

    try {
      parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
      if (!Array.isArray(parsedTags)) parsedTags = [];
    } catch {
      parsedTags = [];
    }

    const currentModel = category === "lead" ? Lead : Contact;

    let nextUserTagOrder =
      user.tags.length > 0
        ? Math.max(...user.tags.map(t => t.order ?? 0)) + 1
        : 0;

    const ensuredUserTags = [];

    for (const tagItem of parsedTags) {
      const tagText = tagItem.tag?.trim();
      const emoji = tagItem.emoji || "🏷️";

      if (!tagText) continue;

      let existingUserTag = user.tags.find(
        t => t.tag.toLowerCase() === tagText.toLowerCase()
      );

      if (!existingUserTag) {
        existingUserTag = {
          tag_id: new mongoose.Types.ObjectId(),
          tag: tagText,
          emoji,
          order: nextUserTagOrder++,
        };

        user.tags.push(existingUserTag);
      }

      ensuredUserTags.push(existingUserTag);
    }

    if (ensuredUserTags.length > 0) {
      await user.save();
    }


    const baseContactTags = ensuredUserTags.map((t, index) => ({
      tag_id: t.tag_id,
      tag: t.tag,
      emoji: t.emoji,
      globalOrder: t.order,
      order: index, // 👈 per-contact order starts from 0
    }));


    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No contacts provided",
      });
    }

    // Determine if contacts should be marked as leads
    const shouldBeLeads = category === "lead";

    // Get valid statuses for the user based on category
    const validStatuses = shouldBeLeads
      ? (user.leadStatuses || []).map((s) => s.value)
      : (user.contactStatuses || []).map((s) => s.value);

    // Allow both camelCase (schema) and lowercase (incoming)
    const allowedFields = [
      "firstname",
      "lastname",
      "company",
      "designation",
      "linkedin",
      "instagram",
      "telegram",
      "twitter",
      "facebook",
      "emailaddresses",
      "phonenumbers",
      "emailAddresses",
      "phoneNumbers",
      "status",
    ];

    const newContacts = [];
    const skippedContacts = [];

    // preprocess contact: normalize keys to schema names: emailAddresses, phoneNumbers
    const preprocessContact = (contact) => {
      const invalidKeys = Object.keys(contact).filter((key) => !allowedFields.includes(key));
      if (invalidKeys.length > 0) {
        throw new Error(`Invalid columns: ${invalidKeys.join(", ")}`);
      }

      const {
        firstname = "",
        lastname = "",
        company = "",
        designation = "",
        linkedin = "",
        instagram = "",
        telegram = "",
        twitter = "",
        facebook = "",
        status = "",
      } = contact;

      // Accept both shapes: contact.phoneNumbers (camel) or contact.phonenumbers (lowercase)
      const incomingPhoneField = Array.isArray(contact.phoneNumbers)
        ? contact.phoneNumbers
        : Array.isArray(contact.phonenumbers)
          ? contact.phonenumbers
          : contact.phoneNumbers || contact.phonenumbers || [];

      // Accept both shapes for emails
      const incomingEmailField = Array.isArray(contact.emailAddresses)
        ? contact.emailAddresses
        : Array.isArray(contact.emailaddresses)
          ? contact.emailaddresses
          : contact.emailAddresses || contact.emailaddresses || [];

      // Build normalized phoneNumbers array of objects { countryCode, number }
      let phoneList = [];
      if (Array.isArray(incomingPhoneField) && incomingPhoneField.length > 0) {
        const num = incomingPhoneField[0]; // only first number (keeps your logic)
        let phoneObj = { countryCode: "", number: "" };

        if (typeof num === "object" && num.number) {
          phoneObj.countryCode = num.countryCode || "";
          phoneObj.number = String(num.number).replace(/[^\d]/g, "");
        } else {
          const parsed = parsePhoneNumberFromString(String(num));
          if (parsed && parsed.nationalNumber) {
            phoneObj.countryCode = parsed.countryCallingCode || "";
            phoneObj.number = String(parsed.nationalNumber);
          } else {
            phoneObj.number = String(num).replace(/[^\d]/g, "");
          }
        }
        // default country code 971 if missing
        if (phoneObj.number && (!phoneObj.countryCode || phoneObj.countryCode.trim() === "")) {
          // phoneObj.countryCode = "971";
          phoneObj.countryCode = String(defaultCountryCode);
        }
        if (phoneObj.number) phoneList.push(phoneObj);
      } else if (incomingPhoneField) {
        // fallback if it's a string
        // let phoneObj = { countryCode: "971", number: "" };
        let phoneObj = { countryCode: String(defaultCountryCode), number: "" };
        const parsed = parsePhoneNumberFromString(String(incomingPhoneField));
        if (parsed && parsed.nationalNumber) {
          // phoneObj.countryCode = parsed.countryCallingCode || "971";
          phoneObj.countryCode = parsed.countryCallingCode || String(defaultCountryCode);
          phoneObj.number = String(parsed.nationalNumber);
        } else {
          phoneObj.number = String(incomingPhoneField).replace(/[^\d]/g, "");
        }
        if (phoneObj.number) phoneList.push(phoneObj);
      }

      const emailList = Array.isArray(incomingEmailField)
        ? incomingEmailField.filter((e) => e).map(e => String(e).toLowerCase())
        : incomingEmailField
          ? [String(incomingEmailField).toLowerCase()]
          : [];

      // Validate status if provided
      if (status && status.trim() !== "") {
        if (!validStatuses.includes(status)) {
          const categoryName = shouldBeLeads ? "lead" : "contact";
          throw new Error(`Invalid ${categoryName} status: "${status}".`);
        }
      }

      return {
        raw: contact,
        normalized: {
          firstname,
          lastname,
          company,
          designation,
          linkedin,
          instagram,
          telegram,
          twitter,
          facebook,
          emailAddresses: emailList,
          phoneNumbers: phoneList,
          status,
        },
      };
    };

    // --- company-wide existing sets (phones + emails) ---
    const { existingEmails, existingPhones, addPhoneVariants } = await buildGlobalDuplicateSets(req.user._id);

    // keep track of numbers/emails added in this entire import to prevent same-batch duplicates
    const batchNewEmails = new Set();
    const batchNewPhones = new Set();

    // Process in batches
    for (let batchStart = 0; batchStart < contacts.length; batchStart += BATCH_SIZE) {
      const batchContacts = contacts.slice(batchStart, batchStart + BATCH_SIZE);
      const processedBatch = batchContacts.map(preprocessContact);

      const bulkOps = [];

      for (const { raw, normalized } of processedBatch) {
        const {
          firstname,
          lastname,
          company,
          designation,
          linkedin,
          instagram,
          telegram,
          twitter,
          facebook,
          emailAddresses,
          phoneNumbers,
          status,
        } = normalized;

        // --- company-wide duplicate checks ---
        // email duplicate if any email present in company existingEmails or batchNewEmails
        let isDuplicate = false;
        for (const e of emailAddresses || []) {
          if (!e) continue;
          const eNorm = e.toLowerCase().trim();
          if (existingEmails.has(eNorm) || batchNewEmails.has(eNorm)) {
            isDuplicate = true;
            break;
          }
        }

        // phone duplicate if any phone matches existingPhones or batchNewPhones (normalize)
        if (!isDuplicate && Array.isArray(phoneNumbers) && phoneNumbers.length > 0) {
          for (const p of phoneNumbers) {
            if (!p || !p.number) continue;
            const digits = String(p.number).replace(/\D/g, "");
            if (!digits) continue;
            const cc = p.countryCode ? String(p.countryCode).replace(/^\+/, "") : "";
            const fullPlus = cc ? `+${cc}${digits}` : digits;
            const fullNoPlus = cc ? `${cc}${digits}` : digits;

            if (
              existingPhones.has(fullPlus) ||
              existingPhones.has(fullNoPlus) ||
              existingPhones.has(digits) ||
              batchNewPhones.has(fullPlus) ||
              batchNewPhones.has(fullNoPlus) ||
              batchNewPhones.has(digits)
            ) {
              isDuplicate = true;
              break;
            }
          }
        }

        if (isDuplicate) {
          skippedContacts.push({
            ...raw,
            reason: "Duplicate found in company contacts/leads or earlier in this import",
          });
          continue;
        }

        // Not a duplicate -> prepare insert
        const generatedId = new mongoose.Types.ObjectId();
        const newContact = {
          _id: generatedId,
          contact_id: generatedId,
          firstname,
          lastname,
          company,
          designation,
          linkedin,
          instagram,
          telegram,
          twitter,
          facebook,
          emailAddresses,
          phoneNumbers,
          status,
          isLead: shouldBeLeads,
          tags: baseContactTags.map(t => ({ ...t })),
          activities: [
            {
              action: shouldBeLeads ? "lead_created" : "contact_created",
              type: "contact",
              title: shouldBeLeads ? "Lead Imported" : "Contact Imported",
              description: `${firstname} ${lastname}`,
            },
          ],
          createdBy: req.user._id,
        };

        newContacts.push(newContact);
        bulkOps.push({ insertOne: { document: newContact } });

        // Add these to batchNew sets to prevent duplicates later in this import
        for (const e of emailAddresses || []) {
          if (e) batchNewEmails.add(String(e).toLowerCase().trim());
        }
        for (const p of phoneNumbers || []) {
          if (!p || !p.number) continue;
          const digits = String(p.number).replace(/\D/g, "");
          if (!digits) continue;
          const cc = p.countryCode ? String(p.countryCode).replace(/^\+/, "") : "";
          const fullPlus = cc ? `+${cc}${digits}` : digits;
          const fullNoPlus = cc ? `${cc}${digits}` : digits;
          batchNewPhones.add(fullPlus);
          batchNewPhones.add(fullNoPlus);
          batchNewPhones.add(digits);
        }
      } // end processedBatch loop

      // execute bulk write for this batch
      if (bulkOps.length > 0) {
        await currentModel.bulkWrite(bulkOps, { ordered: false });
      }
    } // end all batches

    return res.status(201).json({
      status: "success",
      message: `Processed ${contacts.length} contact(s): ${newContacts.length} added, ${skippedContacts.length} skipped (duplicates found in company).`,
      data: {
        added: newContacts,
        skipped: skippedContacts,
      },
    });
  } catch (error) {
    console.error("Bulk contact save error:", error);
    return res.status(500).json({
      status: "error",
      message: error.message || "Something went wrong",
    });
  }
};

module.exports = { saveBulkContacts };
