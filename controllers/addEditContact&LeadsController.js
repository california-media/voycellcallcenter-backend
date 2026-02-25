const mongoose = require("mongoose");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const User = require("../models/userModel");
const s3 = require("../utils/s3");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const { logActivityToContact } = require("../utils/activityLogger");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

// --------------------------
// company-wide duplicate helper
// returns sets and maps for quick lookup and owner info
// --------------------------
const buildGlobalDuplicateSets = async (userId) => {
  const loggedInUser = await User.findById(userId).lean();
  if (!loggedInUser) throw new Error("User not found");

  // determine the company admin id
  let companyAdminId = null;
  if (String(loggedInUser.role) === "companyAdmin") {
    companyAdminId = loggedInUser._id;
  } else if (loggedInUser.createdByWhichCompanyAdmin) {
    companyAdminId = loggedInUser.createdByWhichCompanyAdmin;
  } else {
    companyAdminId = loggedInUser._id;
  }

  // all users in this company (admin + agents)
  const companyUsers = await User.find({
    $or: [{ _id: companyAdminId }, { createdByWhichCompanyAdmin: companyAdminId }],
  }).select("_id").lean();

  const allUserIds = companyUsers.map((u) => u._id);

  // fetch contacts & leads created by any of these users
  const [contacts, leads] = await Promise.all([
    Contact.find({ createdBy: { $in: allUserIds } }, "phoneNumbers emailAddresses createdBy contact_id firstname lastname isLead").lean(),
    Lead.find({ createdBy: { $in: allUserIds } }, "phoneNumbers emailAddresses createdBy contact_id firstname lastname isLead").lean(),
  ]);

  const existingPhones = new Set();
  const existingEmails = new Set();

  // maps: key (variant) -> owner info { model, createdBy, contactId, firstname, lastname }
  const phoneOwnerMap = new Map();
  const emailOwnerMap = new Map();

  const addPhoneOwnerVariants = (phoneObj, ownerInfo) => {
    if (!phoneObj || !phoneObj.number) return;
    const digits = String(phoneObj.number).replace(/\D/g, "");
    if (!digits) return;
    const cc = phoneObj.countryCode ? String(phoneObj.countryCode).replace(/^\+/, "") : "";

    // 3 variants we store/check: +CCdigits, CCdigits, digits
    if (cc) {
      const plusVariant = `+${cc}${digits}`;
      const noPlusVariant = `${cc}${digits}`;
      existingPhones.add(plusVariant);
      existingPhones.add(noPlusVariant);
      if (!phoneOwnerMap.has(plusVariant)) phoneOwnerMap.set(plusVariant, ownerInfo);
      if (!phoneOwnerMap.has(noPlusVariant)) phoneOwnerMap.set(noPlusVariant, ownerInfo);
    }
    existingPhones.add(digits);
    if (!phoneOwnerMap.has(digits)) phoneOwnerMap.set(digits, ownerInfo);
  };

  const addEmailOwner = (email, ownerInfo) => {
    if (!email) return;
    const e = String(email).toLowerCase().trim();
    existingEmails.add(e);
    if (!emailOwnerMap.has(e)) emailOwnerMap.set(e, ownerInfo);
  };

  // add contact owners
  for (const c of contacts || []) {
    const ownerInfo = {
      model: "Contact",
      createdBy: c.createdBy,
      contactId: c.contact_id || c._id,
      firstname: c.firstname || "",
      lastname: c.lastname || "",
      isLead: !!c.isLead,
    };
    for (const p of c.phoneNumbers || []) addPhoneOwnerVariants(p, ownerInfo);
    for (const e of c.emailAddresses || []) addEmailOwner(e, ownerInfo);
  }

  // add lead owners
  for (const l of leads || []) {
    const ownerInfo = {
      model: "Lead",
      createdBy: l.createdBy,
      contactId: l.contact_id || l._id,
      firstname: l.firstname || "",
      lastname: l.lastname || "",
      isLead: !!l.isLead,
    };
    for (const p of l.phoneNumbers || []) addPhoneOwnerVariants(p, ownerInfo);
    for (const e of l.emailAddresses || []) addEmailOwner(e, ownerInfo);
  }

  return { existingPhones, existingEmails, phoneOwnerMap, emailOwnerMap };
};


const parseBoolean = (val) => {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val === 1;
  if (typeof val === "string") {
    const v = val.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0" || v === "") return false;
  }
  return false;
};

const uploadImageToS3 = async (file) => {
  const ext = path.extname(file.originalname);
  const name = path.basename(file.originalname, ext);
  const fileName = `contactImages/${name}_${Date.now()}${ext}`;

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  await s3.send(new PutObjectCommand(params));

  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
};

const addEditContactisLeads = async (req, res) => {
  try {
    let {
      contact_id,
      category, // "contact" or "lead"
      firstname,
      lastname,
      emailAddresses,
      phoneNumbers,
      company,
      designation,
      linkedin,
      instagram,
      telegram,
      twitter,
      facebook,
      website,
    } = req.body;

    const isLeadReq = category.toLowerCase() === "lead";
    const currentModel = isLeadReq ? Lead : Contact;
    const user_id = req.user._id;
    // Parse arrays
    const emails = Array.isArray(emailAddresses)
      ? emailAddresses
      : JSON.parse(emailAddresses || "[]");

    const phones = Array.isArray(phoneNumbers)
      ? phoneNumbers
      : JSON.parse(phoneNumbers || "[]");

    const isCreating = !contact_id || contact_id === "0";

    // ------------------------------------------------------------------
    // COMPANY-WIDE DUPLICATE CHECK FOR EMAIL / PHONE
    // ------------------------------------------------------------------
    // Build company-wide phone/email maps (admin + all agents).
    const { existingPhones, existingEmails, phoneOwnerMap, emailOwnerMap } =
      await buildGlobalDuplicateSets(user_id);

    // Normalize incoming emails & phones
    const incomingEmails = (emails || []).map((e) => String(e).toLowerCase().trim());
    const incomingPhonesNormalized = (phones || []).map((p) => {
      // incoming phone may be object { countryCode, number } or string
      if (!p) return null;
      if (typeof p === "object") {
        const cc = p.countryCode ? String(p.countryCode).replace(/^\+/, "") : "";
        const digits = String(p.number || "").replace(/\D/g, "");
        const plus = cc ? `+${cc}${digits}` : digits;
        const noPlus = cc ? `${cc}${digits}` : digits;
        return { cc, digits, plus, noPlus };
      } else {
        // string fallback
        const parsed = parsePhoneNumberFromString(String(p));
        if (parsed) {
          const cc = parsed.countryCallingCode ? String(parsed.countryCallingCode) : "";
          const digits = String(parsed.nationalNumber || "").replace(/\D/g, "");
          const plus = cc ? `+${cc}${digits}` : digits;
          const noPlus = cc ? `${cc}${digits}` : digits;
          return { cc, digits, plus, noPlus };
        } else {
          const digits = String(p).replace(/\D/g, "");
          return { cc: "", digits, plus: digits, noPlus: digits };
        }
      }
    }).filter(Boolean);

    // Check duplicates for create: if ANY incoming email or phone exists in company -> block create
    // Prefer phone check first (faster).
    let duplicateOwner = null;
    for (const p of incomingPhonesNormalized) {
      if (!p || !p.digits) continue;
      if (existingPhones.has(p.plus) || existingPhones.has(p.noPlus) || existingPhones.has(p.digits)) {
        // get owner info from map
        duplicateOwner = phoneOwnerMap.get(p.plus) || phoneOwnerMap.get(p.noPlus) || phoneOwnerMap.get(p.digits);
        break;
      }
    }
    if (!duplicateOwner) {
      for (const e of incomingEmails) {
        if (!e) continue;
        if (existingEmails.has(e)) {
          duplicateOwner = emailOwnerMap.get(e);
          break;
        }
      }
    }

    if (isCreating && duplicateOwner) {
      const ownerId = duplicateOwner.createdBy;
      const ownerUser = await User.findById(ownerId).lean();
      const ownerUserName = ownerUser ? ownerUser.firstname + " " + ownerUser.lastname : "Unknown";
      return res.status(409).json({
        status: "error",
        message: "Duplicate found in company contacts/leads",
        duplicate: {
          model: duplicateOwner.model,
          contactId: duplicateOwner.contactId,
          name: `${duplicateOwner.firstname} ${duplicateOwner.lastname}`.trim(),
          ownerUserId: duplicateOwner.createdBy,
          ownerUserName: ownerUserName,

        },
      });
    }

    // ------------------------------------------------------------------
    // IMAGE UPLOAD
    // ------------------------------------------------------------------
    let finalImageURL = null;
    if (req.file) {
      finalImageURL = await uploadImageToS3(req.file);
    }

    // ------------------------------------------------------------------
    // CREATE
    // ------------------------------------------------------------------
    if (isCreating) {
      const newID = new mongoose.Types.ObjectId();

      const created = await currentModel.create({
        ...req.body,
        _id: newID,
        contact_id: newID,
        emailAddresses: emails,
        phoneNumbers: phones,
        contactImageURL: finalImageURL || "",
        status: isLeadReq ? "interested" : "",
        isLead: isLeadReq,
        company,
        designation,
        linkedin,
        instagram,
        telegram,
        twitter,
        facebook,
        website,
        createdBy: user_id,
        activities: [
          {
            action: isLeadReq ? "lead_created" : "contact_created",
            type: isLeadReq ? "lead" : "contact",
            description: isLeadReq ? "Lead Created" : "Contact Created",
            title: `${firstname} ${lastname}`,
          },
        ],
      });

      return res.status(201).json({
        status: "success",
        message: `${category} created successfully`,
        data: created,
      });
    }

    // ------------------------------------------------------------------
    // UPDATE (FIND EXISTING)
    // ------------------------------------------------------------------
    const existing =
      (await Contact.findOne({ contact_id })) ||
      (await Lead.findOne({ contact_id }));

    if (!existing)
      return res
        .status(404)
        .json({ status: "error", message: "Record not found" });

    const prevCategory = existing.isLead ? "lead" : "contact";

    // // Duplicate check for updates → exclude current doc
    const updateIncomingEmails = (emails || []).map(e => String(e).toLowerCase().trim());
    const updateIncomingPhones = (phones || []).map(p => {
      if (!p) return null;
      if (typeof p === "object") {
        const cc = p.countryCode ? String(p.countryCode).replace(/^\+/, "") : "";
        const digits = String(p.number || "").replace(/\D/g, "");
        const plus = cc ? `+${cc}${digits}` : digits;
        const noPlus = cc ? `${cc}${digits}` : digits;
        return { cc, digits, plus, noPlus };
      } else {
        const parsed = parsePhoneNumberFromString(String(p));
        if (parsed) {
          const cc = parsed.countryCallingCode ? String(parsed.countryCallingCode) : "";
          const digits = String(parsed.nationalNumber || "").replace(/\D/g, "");
          const plus = cc ? `+${cc}${digits}` : digits;
          const noPlus = cc ? `${cc}${digits}` : digits;
          return { cc, digits, plus, noPlus };
        } else {
          const digits = String(p).replace(/\D/g, "");
          return { cc: "", digits, plus: digits, noPlus: digits };
        }
      }
    }).filter(Boolean);

    // check phones
    let duplicateFoundOnUpdate = null;
    for (const p of updateIncomingPhones) {
      if (!p || !p.digits) continue;
      const owner = phoneOwnerMap.get(p.plus) || phoneOwnerMap.get(p.noPlus) || phoneOwnerMap.get(p.digits);
      if (!owner) continue;
      // if owner.contactId is same as existing.contact_id -> that's fine (updating same record)
      if (String(owner.contactId) === String(existing.contact_id || existing._id)) {
        continue;
      }
      duplicateFoundOnUpdate = owner;
      break;
    }

    if (!duplicateFoundOnUpdate) {
      for (const e of updateIncomingEmails) {
        const owner = emailOwnerMap.get(e);
        if (!owner) continue;
        if (String(owner.contactId) === String(existing.contact_id || existing._id)) {
          continue;
        }
        duplicateFoundOnUpdate = owner;
        break;
      }
    }

    if (duplicateFoundOnUpdate) {
      const ownerId = duplicateFoundOnUpdate.createdBy;
      const ownerUser = await User.findById(ownerId).lean();
      const ownerUserName = ownerUser ? ownerUser.firstname + " " + ownerUser.lastname : "Unknown";
      return res.status(409).json({
        status: "error",
        message: "Another record in your company already has this phone/email",
        duplicate: {
          model: duplicateFoundOnUpdate.model,
          contactId: duplicateFoundOnUpdate.contactId,
          name: `${duplicateFoundOnUpdate.firstname} ${duplicateFoundOnUpdate.lastname}`.trim(),
          ownerUserId: duplicateFoundOnUpdate.createdBy,
          ownerUserName: ownerUserName,
        },
      });
    }


    // ------------------------------------------------------------------
    // CONVERT (CONTACT ↔ LEAD)
    // ------------------------------------------------------------------
    if (prevCategory !== category.toLowerCase()) {
      const old = existing.toObject();
      await existing.deleteOne();

      let newStatus = "";
      let activity = "";
      let activityDescription = "";
      let activityTitle = "";
      let activityType = "";

      if (isLeadReq) {
        newStatus = "interested";
        activity = "contact_converted_to_lead";
        activityTitle = "contact to lead";
        activityDescription = "contact converted to lead";
        activityType = "lead";
      } else {
        newStatus = "notInterested";
        activity = "lead_converted_to_contact";
        activityTitle = "lead to contact";
        activityDescription = "lead converted to contact";
        activityType = "contact";
      }

      const newDoc = await currentModel.create({
        ...old,

        firstname: firstname || old.firstname,
        lastname: lastname || old.lastname,

        emailAddresses: emails.length ? emails : old.emailAddresses,
        phoneNumbers: phones.length ? phones : old.phoneNumbers,

        company: company || old.company,
        designation: designation || old.designation,
        linkedin: linkedin || old.linkedin,
        instagram: instagram || old.instagram,
        telegram: telegram || old.telegram,
        twitter: twitter || old.twitter,
        facebook: facebook || old.facebook,
        website: website || old.website,
        createdBy: old.createdBy,
        isLead: isLeadReq,
        status: newStatus,
        contactImageURL: finalImageURL || old.contactImageURL,

        // PRESERVE TASKS, MEETINGS, TAGS
        tasks: old.tasks,
        meetings: old.meetings,
        tags: old.tags,

        activities: [
          ...(old.activities || []),
          {
            action: activity,
            title: activityTitle,
            type: activityType,
            description: activityDescription,
          },
        ],
      });

      return res.status(200).json({
        status: "success",
        message: `Converted to ${category} successfully`,
        data: newDoc,
      });
    }

    // ------------------------------------------------------------------
    // NORMAL UPDATE - CORRECTED
    // ------------------------------------------------------------------
    const updatePayload = {
      firstname: firstname,
      lastname: lastname,
      company: company,
      designation: designation,
      linkedin: linkedin,
      instagram: instagram,
      telegram: telegram,
      twitter: twitter,
      facebook: facebook,
      website: website,
      isFavourite: req.body.isFavourite,
    };

    // 2. Conditional updates for arrays (email, phone)
    const emailBodyPresent = req.body.emailAddresses !== undefined;
    const phoneBodyPresent = req.body.phoneNumbers !== undefined;

    if (emailBodyPresent) {
      updatePayload.emailAddresses = emails;
    }
    if (phoneBodyPresent) {
      updatePayload.phoneNumbers = phones;
    }

    // Update with non-empty values from request body
    if (firstname !== undefined) updatePayload.firstname = firstname;
    // ... repeat for other simple fields

    // Explicitly handle arrays - use the parsed array if it's not null/undefined
    if (req.body.emailAddresses !== undefined)
      updatePayload.emailAddresses = emails;
    if (req.body.phoneNumbers !== undefined)
      updatePayload.phoneNumbers = phones;

    // 3. Conditional update for the image URL
    if (finalImageURL) {
      updatePayload.contactImageURL = finalImageURL; // Use the newly uploaded URL
    } else {
      // If no new image was uploaded, ensure the existing one is preserved
      updatePayload.contactImageURL = existing.contactImageURL;
    }

    // 4. Prepare activity
    const activity = {
      action: isLeadReq ? "lead_updated" : "contact_updated",
      title: `${firstname || existing.firstname} ${lastname || existing.lastname
        }`,
      type: isLeadReq ? "lead" : "contact",
      description: isLeadReq ? "Lead Updated" : "Contact Updated",
    };

    // 5. Apply update atomically with $set and $push
    const updated = await currentModel.findOneAndUpdate(
      { contact_id },
      { $set: updatePayload, $push: { activities: activity } }, // Use $set to update fields
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({
        status: "error",
        message: "Record not found after update attempt",
      });
    }

    return res.status(200).json({
      status: "success",
      message: `${category} updated successfully`,
      data: updated,
    });
  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

const deleteContactOrLead = async (req, res) => {
  try {
    const { contact_id, category } = req.body;
    const userId = req.user._id;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required",
      });
    }

    if (category && category !== "contact" && category !== "lead") {
      return res.status(400).json({
        status: "error",
        message: "category must be either 'contact' or 'lead' if provided",
      });
    }

    let user = await User.findById(req.user._id);

    let allowedUserIds = [req.user._id]; // default: self

    if (user.role === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: req.user._id,
        role: "user",
      }).select("_id");

      const agentIds = agents.map((agent) => agent._id);

      // company admin can delete:
      // 1. their own contacts
      // 2. their agents' contacts
      allowedUserIds = [req.user._id, ...agentIds];
    }

    // If category is not provided, try both models
    if (!category) {
      const record =
        (await Contact.findOneAndDelete({
          _id: contact_id,
          // createdBy: userId,
          createdBy: { $in: allowedUserIds },
        })) ||
        (await Lead.findOneAndDelete({
          _id: contact_id,
          // createdBy: userId,
          createdBy: { $in: allowedUserIds },
        }));

      if (!record) {
        return res.status(404).json({
          status: "error",
          message: "Record not found or unauthorized",
        });
      }

      return res.status(200).json({
        status: "success",
        message: "Record deleted",
      });
    }

    // Determine which model to use based on category
    const isLeadReq = category.toLowerCase() === "lead";
    const currentModel = isLeadReq ? Lead : Contact;
    const itemType = isLeadReq ? "Lead" : "Contact";

    // Find and delete record
    const record = await currentModel.findOneAndDelete({
      _id: contact_id,
      // createdBy: userId,
      createdBy: { $in: allowedUserIds },
    });

    if (!record) {
      return res.status(404).json({
        status: "error",
        message: `${itemType} not found or unauthorized`,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Record deleted",
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Toggle favorite status of a contact
 * Simple endpoint that only updates isFavourite field
 * No validation required - just flip the boolean
 */
const toggleContactFavorite = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized: User not found",
      });
    }

    // Determine access scope
    let createdByFilter = { createdBy: req.user._id };

    // If Company Admin → include agents
    if (user.role === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: user._id,
      }).select("_id");

      const agentIds = agents.map((a) => a._id);

      createdByFilter = {
        createdBy: { $in: [user._id, ...agentIds] },
      };
    }

    const { contact_id, isFavourite, category } = req.body;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "Contact ID is required",
      });
    }

    if (category && category !== "contact" && category !== "lead") {
      return res.status(400).json({
        status: "error",
        message: "category must be either 'contact' or 'lead' if provided",
      });
    }

    // If category is not provided, try both models
    if (!category) {
      let record =
        (await Contact.findOne({
          _id: contact_id,
          ...createdByFilter,
        })) ||
        (await Lead.findOne({
          _id: contact_id,
          ...createdByFilter,
        }));

      if (!record) {
        return res.status(404).json({
          status: "error",
          message: "Record not found or unauthorized",
        });
      }

      const itemType = record.isLead ? "lead" : "contact";

      // Update only the isFavourite field
      record.isFavourite = Boolean(isFavourite);
      await record.save();

      await logActivityToContact(itemType, record._id, {
        action: isFavourite
          ? `${itemType} favorited`
          : `${itemType} unfavorited`,
        type: itemType,
        title: isFavourite
          ? `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} Favorited`
          : `${itemType.charAt(0).toUpperCase() + itemType.slice(1)
          } Unfavorited`,
        description: isFavourite
          ? `${itemType.charAt(0).toUpperCase() + itemType.slice(1)
          } Added to Favorites`
          : `${itemType.charAt(0).toUpperCase() + itemType.slice(1)
          } Removed from Favorites`,
      });

      return res.status(200).json({
        status: "success",
        message: isFavourite
          ? `${itemType.charAt(0).toUpperCase() + itemType.slice(1)
          } added to favorites`
          : `${itemType.charAt(0).toUpperCase() + itemType.slice(1)
          } removed from favorites`,
        data: {
          contact_id: record.contact_id,
          isFavourite: record.isFavourite,
        },
      });
    }

    // Determine which model to use based on category
    const isLeadReq = category.toLowerCase() === "lead";
    const currentModel = isLeadReq ? Lead : Contact;
    const itemType = isLeadReq ? "lead" : "contact";
    const ItemTypeCap = itemType.charAt(0).toUpperCase() + itemType.slice(1);

    // Find the record
    const record = await currentModel.findOne({
      _id: contact_id,
      ...createdByFilter,
    });

    if (!record) {
      return res.status(404).json({
        status: "error",
        message: `${ItemTypeCap} not found or unauthorized`,
      });
    }

    // Update only the isFavourite field
    record.isFavourite = Boolean(isFavourite);
    await record.save();

    await logActivityToContact(itemType, record._id, {
      action: isFavourite ? `${itemType} favorited` : `${itemType} unfavorited`,
      type: itemType,
      title: isFavourite
        ? `${ItemTypeCap} Favorited`
        : `${ItemTypeCap} Unfavorited`,
      description: isFavourite
        ? `${ItemTypeCap} Added to Favorites`
        : `${ItemTypeCap} Removed from Favorites`,
    });

    res.status(200).json({
      status: "success",
      message: isFavourite
        ? `${ItemTypeCap} added to favorites`
        : `${ItemTypeCap} removed from favorites`,
      data: {
        contact_id: record.contact_id,
        isFavourite: record.isFavourite,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Batch delete contacts
 * Delete multiple contacts at once
 */
const batchDeleteContacts = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized: User not found",
      });
    }

    const { contact_ids, category } = req.body;

    if (
      !contact_ids ||
      !Array.isArray(contact_ids) ||
      contact_ids.length === 0
    ) {
      return res.status(400).json({
        status: "error",
        message: "contact_ids array is required and must not be empty",
      });
    }

    if (category && category !== "contact" && category !== "lead") {
      return res.status(400).json({
        status: "error",
        message: "category must be either 'contact' or 'lead' if provided",
      });
    }

    // Determine which model to use based on category
    const isLeadReq = category && category.toLowerCase() === "lead";
    const currentModel = isLeadReq ? Lead : Contact;

    // 🔐 Determine who this user can delete for
    let allowedUserIds = [req.user._id]; // default: self

    if (user.role === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: req.user._id,
        role: "user",
      }).select("_id");

      const agentIds = agents.map((agent) => agent._id);

      // company admin can delete:
      // 1. their own contacts
      // 2. their agents' contacts
      allowedUserIds = [req.user._id, ...agentIds];
    }

    // Delete records that belong to this user
    const result = await currentModel.deleteMany({
      _id: { $in: contact_ids },
      // createdBy: req.user._id,
      createdBy: { $in: allowedUserIds }
    });

    const itemType = isLeadReq ? "lead" : "contact";

    res.status(200).json({
      status: "success",
      message: `${result.deletedCount} ${itemType}(s) deleted successfully`,
      data: {
        deletedCount: result.deletedCount,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Update first phone number or email address
 * Allows quick inline editing of the primary contact method
 */
const updateFirstPhoneOrEmail = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized: User not found",
      });
    }

    const { contact_id, field, value, category } = req.body;

    if (!contact_id || !field || !value) {
      return res.status(400).json({
        status: "error",
        message: "Contact ID, field, and value are required",
      });
    }

    if (field !== "phone" && field !== "email") {
      return res.status(400).json({
        status: "error",
        message: "Field must be either 'phone' or 'email'",
      });
    }

    if (category && category !== "contact" && category !== "lead") {
      return res.status(400).json({
        status: "error",
        message: "category must be either 'contact' or 'lead' if provided",
      });
    }

    // Determine which model to use based on category
    const isLeadReq = category && category.toLowerCase() === "lead";
    const currentModel = isLeadReq ? Lead : Contact;
    const itemType = isLeadReq ? "lead" : "contact";

    // Find the record
    const contact = await currentModel.findOne({
      _id: contact_id,
      createdBy: req.user._id,
    });

    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)
          } not found or unauthorized`,
      });
    }

    // Update based on field type
    if (field === "phone") {
      // Parse phone number - expecting format like "+1 1234567890" or "1234567890"
      const trimmedValue = value.trim();

      // ✅ Parse full phone number using libphonenumber-js
      const phoneNumber = parsePhoneNumberFromString(trimmedValue);

      if (!phoneNumber || !phoneNumber.isValid()) {
        return res.status(400).json({
          status: "error",
          message: "Invalid phone number",
        });
      }

      // ✅ Extract properly formatted values
      const countryCode = phoneNumber.countryCallingCode; // like "91"
      const number = phoneNumber.nationalNumber; // like "9876543210"

      if (!number) {
        return res.status(400).json({
          status: "error",
          message: "Invalid phone number format",
        });
      }

      // Check if phone already exists for another record in both models
      const duplicatePhone =
        (await Contact.findOne({
          _id: { $ne: contact_id },
          createdBy: req.user._id,
          phoneNumbers: {
            $elemMatch: { countryCode, number },
          },
        })) ||
        (await Lead.findOne({
          _id: { $ne: contact_id },
          createdBy: req.user._id,
          phoneNumbers: {
            $elemMatch: { countryCode, number },
          },
        }));

      if (duplicatePhone) {
        return res.status(400).json({
          status: "error",
          message: "This phone number already exists for another record",
        });
      }

      // Update first phone number or add new if none exists
      if (contact.phoneNumbers && contact.phoneNumbers.length > 0) {
        contact.phoneNumbers[0] = { countryCode, number };
      } else {
        contact.phoneNumbers = [{ countryCode, number }];
      }

      await contact.save();

      await logActivityToContact(itemType, contact._id, {
        action: `${itemType}_phone_updated`,
        type: itemType,
        title: "Phone Number Updated",
        description: `Phone updated to +${countryCode} ${number}`,
      });

      res.status(200).json({
        status: "success",
        message: "Phone number updated successfully",
        data: {
          contact_id: contact._id,
          phone: `+${countryCode} ${number}`,
        },
      });
    } else if (field === "email") {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return res.status(400).json({
          status: "error",
          message: "Invalid email format",
        });
      }

      // Check if email already exists for another record in both models
      const duplicateEmail =
        (await Contact.findOne({
          _id: { $ne: contact_id },
          createdBy: req.user._id,
          emailAddresses: value,
        })) ||
        (await Lead.findOne({
          _id: { $ne: contact_id },
          createdBy: req.user._id,
          emailAddresses: value,
        }));

      if (duplicateEmail) {
        return res.status(400).json({
          status: "error",
          message: "This email already exists for another record",
        });
      }

      // Update first email or add new if none exists
      if (contact.emailAddresses && contact.emailAddresses.length > 0) {
        contact.emailAddresses[0] = value;
      } else {
        contact.emailAddresses = [value];
      }

      await contact.save();

      await logActivityToContact(itemType, contact._id, {
        action: `${itemType}_email_updated`,
        type: itemType,
        title: "Email Updated",
        description: `Email updated to ${value}`,
      });

      res.status(200).json({
        status: "success",
        message: "Email updated successfully",
        data: {
          contact_id: contact._id,
          email: value,
        },
      });
    }
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * ======================================================
 * UPDATE ATTACHMENTS API
 * ======================================================
 * Replaces the entire attachments array for a contact/lead
 * Similar to how tags are managed
 */
const updateAttachments = async (req, res) => {
  try {
    const { contact_id } = req.body;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required",
      });
    }

    // Find the contact
    const contact = await Lead.findOne({
      _id: contact_id,
      createdBy: req.user._id,
    });

    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Contact not found or unauthorized",
      });
    }

    // Upload files to S3
    const uploadFileToS3 = async (file) => {
      const ext = path.extname(file.originalname);
      const name = path.basename(file.originalname, ext);
      const fileName = `attachments/${Date.now()}_${name}${ext}`;

      const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      };

      try {
        await s3.send(new PutObjectCommand(params));
        const fileURL = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
        return fileURL;
      } catch (error) {
        throw new Error("File upload failed");
      }
    };

    // Process uploaded files
    const newAttachments = [];
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        try {
          const fileURL = await uploadFileToS3(file);
          // Get description for this file
          const description = req.body[`description_${i}`] || "";

          const attachment = {
            attachment_id: new mongoose.Types.ObjectId(),
            fileName: file.originalname,
            fileURL,
            fileSize: file.size,
            fileType: file.mimetype,
            description: description,
            uploadedAt: new Date(),
          };
          newAttachments.push(attachment);
        } catch (error) {
        }
      }
    }

    // Parse existing attachments from request body if provided
    let existingAttachments = [];
    if (req.body.existingAttachments) {
      try {
        existingAttachments =
          typeof req.body.existingAttachments === "string"
            ? JSON.parse(req.body.existingAttachments)
            : req.body.existingAttachments;

        // Ensure it's an array
        if (!Array.isArray(existingAttachments)) {
          existingAttachments = [];
        }
      } catch (error) {
        existingAttachments = [];
      }
    }

    // Combine existing and new attachments
    const allAttachments = [...existingAttachments, ...newAttachments];

    // Update contact with new attachments array
    contact.attachments = allAttachments;
    await contact.save();

    // Log activity
    await logActivityToContact("lead", contact._id, {
      action: "attachments_updated",
      type: "contact",
      title: "Attachments Updated",
      description: `Updated attachments (${allAttachments.length} total, ${newAttachments.length} newly added)`,
    });

    return res.status(200).json({
      status: "success",
      message: "Attachments updated successfully",
      data: {
        contact_id: contact._id,
        attachments: contact.attachments,
        newAttachmentsCount: newAttachments.length,
        totalAttachmentsCount: allAttachments.length,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

module.exports = {
  addEditContactisLeads,
  deleteContactOrLead,
  toggleContactFavorite,
  batchDeleteContacts,
  updateFirstPhoneOrEmail,
  updateAttachments,
};
