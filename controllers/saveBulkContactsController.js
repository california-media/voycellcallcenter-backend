const Contact = require("../models/contactModel");
const User = require("../models/userModel");
const mongoose = require("mongoose");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

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
    const { contacts, isLead = false, category = "contact" } = req.body;
    console.log("isLEad:", isLead, "category:", category);
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "No contacts provided",
      });
    }

    // Determine if contacts should be marked as leads
    const shouldBeLeads = isLead === true && category === "lead";

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
    const updatedContacts = [];
    const skippedContacts = [];

    // preprocess contact: normalize keys to schema names: emailAddresses, phoneNumbers
    const preprocessContact = (contact) => {
      const invalidKeys = Object.keys(contact).filter(
        (key) => !allowedFields.includes(key)
      );
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

      // Accept both shapes: contact.phonenumbers (lowercase) or contact.phoneNumbers (camelCase)
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
        if (phoneObj.number) phoneList.push(phoneObj);
      } else if (incomingPhoneField) {
        // fallback if it's a string
        let phoneObj = { countryCode: "", number: "" };
        const parsed = parsePhoneNumberFromString(String(incomingPhoneField));
        if (parsed && parsed.nationalNumber) {
          phoneObj.countryCode = parsed.countryCallingCode || "";
          phoneObj.number = String(parsed.nationalNumber);
        } else {
          phoneObj.number = String(incomingPhoneField).replace(/[^\d]/g, "");
        }
        if (phoneObj.number) phoneList.push(phoneObj);
      }

      const emailList = Array.isArray(incomingEmailField)
        ? incomingEmailField.filter((e) => e)
        : incomingEmailField
        ? [incomingEmailField]
        : [];

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

    // Process in batches
    for (
      let batchStart = 0;
      batchStart < contacts.length;
      batchStart += BATCH_SIZE
    ) {
      const batchContacts = contacts.slice(batchStart, batchStart + BATCH_SIZE);
      const processedBatch = batchContacts.map(preprocessContact);

      // Collect all phone numbers and emails for this batch
      const allNumbers = processedBatch.flatMap((c) =>
        (c.normalized.phoneNumbers || []).map((p) => p.number)
      );
      const allEmails = processedBatch.flatMap(
        (c) => c.normalized.emailAddresses || []
      );

      // Query existing contacts for this user within this batch
      const existingContactsBatch = await Contact.find({
        createdBy: req.user._id,
        $or: [
          {
            "phoneNumbers.number": {
              $in: allNumbers.length ? allNumbers : ["__NONE__"],
            },
          },
          {
            emailAddresses: {
              $in: allEmails.length ? allEmails : ["__NONE__"],
            },
          },
        ],
      }).lean();

      // Build lookup maps
      const emailMap = new Map();
      const phoneMap = new Map();
      for (const ec of existingContactsBatch) {
        (ec.emailAddresses || []).forEach((e) => {
          if (e) emailMap.set(e, ec);
        });
        (ec.phoneNumbers || []).forEach((p) => {
          if (p && p.number) phoneMap.set(p.number, ec);
        });
      }

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

        // Find existing contact by email or phone using maps
        let existing = null;
        for (const e of emailAddresses) {
          if (emailMap.has(e)) {
            existing = emailMap.get(e);
            break;
          }
        }
        if (!existing) {
          for (const p of phoneNumbers) {
            if (phoneMap.has(p.number)) {
              existing = phoneMap.get(p.number);
              break;
            }
          }
        }

        if (!existing) {
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
            activities: [
              {
                action: "lead_created",
                type:  "contact",
                title: shouldBeLeads ? "Lead Imported" : "Contact Imported",
                description: `${firstname} ${lastname}`,
              },
            ],
            createdBy: req.user._id,
          };
          newContacts.push(newContact);
          bulkOps.push({
            insertOne: { document: newContact },
          });
        } else {
          // existing doc found -> compute new phone/email additions
          const existingPhones = existing.phoneNumbers || [];
          const existingEmails = existing.emailAddresses || [];

          const newPhones = (phoneNumbers || []).filter(
            (p) =>
              !existingPhones.some(
                (ep) =>
                  ep.number === p.number && ep.countryCode === p.countryCode
              )
          );
          const newEmails = (emailAddresses || []).filter(
            (e) => !existingEmails.includes(e)
          );

          const hasNewData = newPhones.length > 0 || newEmails.length > 0;
          if (!hasNewData) {
            skippedContacts.push(raw);
            continue;
          }

          bulkOps.push({
            updateOne: {
              filter: { _id: existing._id },
              update: {
                $addToSet: {
                  phoneNumbers: { $each: newPhones },
                  emailAddresses: { $each: newEmails },
                },
                $set: {
                  firstname: firstname || existing.firstname,
                  lastname: lastname || existing.lastname,
                  company: company || existing.company,
                  designation: designation || existing.designation,
                  linkedin: linkedin || existing.linkedin,
                  instagram: instagram || existing.instagram,
                  telegram: telegram || existing.telegram,
                  twitter: twitter || existing.twitter,
                  facebook: facebook || existing.facebook,
                  ...(status && { status }),
                  ...(shouldBeLeads && { isLead: true }),
                },
              },
            },
          });

          updatedContacts.push({ ...existing, ...normalized });
        }
      }

      // Execute bulkWrite for this batch
      if (bulkOps.length > 0) {
        await Contact.bulkWrite(bulkOps, { ordered: false });
      }
    }

    return res.status(201).json({
      status: "success",
      message: `Processed ${contacts.length} contact(s): ${newContacts.length} added, ${updatedContacts.length} updated, ${skippedContacts.length} skipped.`,
      data: {
        added: newContacts,
        updated: updatedContacts,
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
