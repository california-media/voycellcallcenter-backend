const mongoose = require("mongoose");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const User = require("../models/userModel");
const s3 = require("../utils/s3");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const { logActivityToContact } = require("../utils/activityLogger");

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
      website
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
    // DUPLICATE CHECK FOR EMAIL / PHONE
    // ------------------------------------------------------------------
    const duplicateCheck = {
      $or: [
        { emailAddresses: { $in: emails } },
        { "phoneNumbers.number": { $in: phones.map((p) => p.number) } },
      ],
    };

    // If creating → block duplicates across both models
    if (isCreating) {
      const exists =
        (await Contact.findOne(duplicateCheck)) ||
        (await Lead.findOne(duplicateCheck));

      if (exists) {
        return res.status(409).json({
          status: "error",
          message: "Contact/Lead already exists with same email or phone",
        });
      }
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
        contact_id: newID,
        emailAddresses: emails,
        phoneNumbers: phones,
        contactImageURL: finalImageURL || "",
        status: isLeadReq ? "interested" : "contacted",
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

    // Duplicate check for updates → exclude current doc
    const duplicate =
      (await Contact.findOne({
        ...duplicateCheck,
        contact_id: { $ne: existing.contact_id },
      })) ||
      (await Lead.findOne({
        ...duplicateCheck,
        contact_id: { $ne: existing.contact_id },
      }));

    if (duplicate) {
      return res.status(409).json({
        status: "error",
        message: "Another record already exists with this email or phone",
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

      // const newDoc = await currentModel.create({
      //   ...old,
      //   ...req.body,
      //   isLead: isLeadReq,
      //   status: newStatus,
      //   contactImageURL: finalImageURL || old.contactImageURL,
      //   activities: [
      //     ...(old.activities || []),
      //     {
      //       action: activity,
      //       title: activityTitle,
      //       type: activityType,
      //       description: activityDescription,
      //     },
      //   ],
      // });

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
      // 1. Fields that are safe to update with null/undefined if not provided,
      //    or where an empty string is acceptable (social links).
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
      // Note: isFavourite and notes are missing from req.body destructuring but
      // often included in update payloads, ensure they are present if needed.
      // isFavourite: req.body.isFavourite,
      // notes: req.body.notes,
    };

    // 2. Conditional updates for arrays (email, phone)
    // ONLY update if the client explicitly provided data (emails/phones are the parsed arrays).
    // If client *did not* provide `emailAddresses` or `phoneNumbers`, `emails` and `phones`
    // will be empty arrays `[]` from the parsing step, but we check if they came from the body.
    // The safest way is to check if the request body keys exist.

    // A better approach: if the parsed arrays are NOT empty, use them.
    // If they are empty, check if the original request body property was present.

    // If client sends { emailAddresses: [] }, we want to clear the emails.
    // If client sends {}, we want to keep the old emails.

    // Assuming your parsing logic on lines 21-27 is what determines if the client
    // intended to update the array:
    const emailBodyPresent = req.body.emailAddresses !== undefined;
    const phoneBodyPresent = req.body.phoneNumbers !== undefined;

    if (emailBodyPresent) {
      updatePayload.emailAddresses = emails;
    }
    if (phoneBodyPresent) {
      updatePayload.phoneNumbers = phones;
    }

    // Fallback if we assume no body key means no change, but an empty array means clear.
    // The current parsing makes it tricky. Let's use the simplest and most common fix:
    // Only update if the parsed array is NOT empty, or if we *know* the client explicitly
    // intended to send an empty array (which is hard without better client-side checks).
    // For now, if the parsed array is not empty, we update it.
    // The safest approach is the one above using `req.body` presence.
    // Let's use a simpler structure that relies on the initial parsing:

    // Update with non-empty values from request body
    if (firstname !== undefined) updatePayload.firstname = firstname;
    // ... repeat for other simple fields

    // Explicitly handle arrays - use the parsed array if it's not null/undefined
    if (req.body.emailAddresses !== undefined) updatePayload.emailAddresses = emails;
    if (req.body.phoneNumbers !== undefined) updatePayload.phoneNumbers = phones;

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
      title: `${firstname || existing.firstname} ${lastname || existing.lastname}`,
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
      return res.status(404).json({ status: "error", message: "Record not found after update attempt" });
    }

    return res.status(200).json({
      status: "success",
      message: `${category} updated successfully`,
      data: updated,
    });
  } catch (error) {
    console.error("API ERROR:", error);
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

    if (category == "contact") {
      // Find and delete contact
      const contact = await Contact.findOneAndDelete({
        _id: contact_id,
        createdBy: userId,
      });

      if (!contact) {
        return res.status(404).json({
          status: "error",
          message: "Contact not found or unauthorized",
        });
      }
    }
    else if (category == "lead") {
      // Find and delete lead
      const lead = await Lead.findOneAndDelete({
        _id: contact_id,
        createdBy: userId,
      });
      if (!lead) {
        return res.status(404).json({
          status: "error",
          message: "Lead not found or unauthorized",
        });
      }
    } else {
      // Try to find in contacts first
      let contact =
        (await Contact.findOneAndDelete({
          _id: contact_id,
          createdBy: userId,
        })) ||
        (await Lead.findOneAndDelete({
          _id: contact_id,
          createdBy: userId,
        }));
      if (!contact) {
        return res.status(404).json({
          status: "error",
          message: "Record not found or unauthorized",
        });
      }
    }

    res.status(200).json({
      status: "success",
      message: "Record deleted",
    });
  } catch (error) {
    console.error("Error deleting contact:", error);
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

    if (category == "lead") {
      // Find the lead
      const lead = await Lead.findOne({
        _id: contact_id,
        createdBy: req.user._id,
      });
      if (!lead) {
        return res.status(404).json({
          status: "error",
          message: "Lead not found or unauthorized",
        });
      }
      // Update only the isFavourite field
      lead.isFavourite = Boolean(isFavourite);
      await lead.save();
      await logActivityToContact(lead._id, {
        action: isFavourite ? "lead favorited" : "lead unfavorited",
        type: "lead",
        title: isFavourite ? "Lead Favorited" : "Lead Unfavorited",
        description: isFavourite
          ? "Lead Added to Favorites"
          : "Lead Removed from Favorites",
      });

      return res.status(200).json({
        status: "success",
        message: isFavourite
          ? "Lead added to favorites"
          : "Lead removed from favorites",
        data: {
          contact_id: lead.contact_id,
          isFavourite: lead.isFavourite,
        },
      });
    } else if (category == "contact") {
      // Find the contact
      const contact = await Contact.findOne({
        _id: contact_id,
        createdBy: req.user._id,
      });

      if (!contact) {
        return res.status(404).json({
          status: "error",
          message: "Contact not found or unauthorized",
        });
      }

      // Update only the isFavourite field
      contact.isFavourite = Boolean(isFavourite);
      await contact.save();

      await logActivityToContact(contact._id, {
        action: isFavourite ? "contact favorited" : "contact unfavorited",
        type: "contact",
        title: isFavourite ? "Contact Favorited" : "Contact Unfavorited",
        description: isFavourite
          ? "Contact Added to Favorites"
          : "Contact Removed from Favorites",
      });

      res.status(200).json({
        status: "success",
        message: isFavourite
          ? "Contact added to favorites"
          : "Contact removed from favorites",
        data: {
          contact_id: contact.contact_id,
          isFavourite: contact.isFavourite,
        },
      });
    } else {
      // Try to find in contacts first
      let contact =
        (await Contact
          .findOne({
            _id: contact_id,
            createdBy: req.user._id,
          })) ||
        (await Lead.findOne({
          _id: contact_id,
          createdBy: req.user._id,
        }));
      if (!contact) {
        return res.status(404).json({
          status: "error",
          message: "Record not found or unauthorized",
        });
      }
      // Update only the isFavourite field
      contact.isFavourite = Boolean(isFavourite);
      await contact.save();
      await logActivityToContact(contact._id, {
        action: isFavourite ? "record favorited" : "record unfavorited",
        type: contact.isLead ? "lead" : "contact",
        title: isFavourite ? "Record Favorited" : "Record Unfavorited",
        description: isFavourite
          ? "Record Added to Favorites"
          : "Record Removed from Favorites",
      });
      res.status(200).json({
        status: "success",
        message: isFavourite
          ? "Record added to favorites"
          : "Record removed from favorites",
        data: {
          contact_id: contact.contact_id,
          isFavourite: contact.isFavourite,
        },
      });
    }


  } catch (error) {
    console.error("Error toggling favorite:", error);
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

    const { contact_ids } = req.body;

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

    // Delete contacts that belong to this user
    const result = await Contact.deleteMany({
      _id: { $in: contact_ids },
      createdBy: req.user._id,
    });

    res.status(200).json({
      status: "success",
      message: `${result.deletedCount} contact(s) deleted successfully`,
      data: {
        deletedCount: result.deletedCount,
      },
    });
  } catch (error) {
    console.error("Error batch deleting contacts:", error);
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

    const { contact_id, field, value } = req.body;

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

    // Find the contact
    const contact = await Contact.findOne({
      _id: contact_id,
      createdBy: req.user._id,
    });

    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Contact not found or unauthorized",
      });
    }

    // Update based on field type
    if (field === "phone") {
      // Parse phone number - expecting format like "+1 1234567890" or "1234567890"
      let countryCode = "";
      let number = "";

      const trimmedValue = value.trim();

      // Check if it starts with +
      if (trimmedValue.startsWith("+")) {
        const parts = trimmedValue.slice(1).split(/\s+/);
        if (parts.length >= 2) {
          countryCode = parts[0].replace(/[^\d]/g, "");
          number = parts.slice(1).join("").replace(/[^\d]/g, "");
        } else {
          // No space, try to split (assume first 1-3 digits are country code)
          const allDigits = trimmedValue.slice(1).replace(/[^\d]/g, "");
          if (allDigits.length > 3) {
            countryCode = allDigits.slice(0, 2); // Assume 2-digit country code
            number = allDigits.slice(2);
          } else {
            number = allDigits;
            countryCode = "1"; // Default to US
          }
        }
      } else {
        // No country code, just number
        number = trimmedValue.replace(/[^\d]/g, "");
        countryCode = "1"; // Default to US
      }

      if (!number) {
        return res.status(400).json({
          status: "error",
          message: "Invalid phone number format",
        });
      }

      // Check if phone already exists for another contact
      const duplicatePhone = await Contact.findOne({
        _id: { $ne: contact_id },
        createdBy: req.user._id,
        phoneNumbers: {
          $elemMatch: { countryCode, number },
        },
      });

      if (duplicatePhone) {
        return res.status(400).json({
          status: "error",
          message: "This phone number already exists for another contact",
        });
      }

      // Update first phone number or add new if none exists
      if (contact.phoneNumbers && contact.phoneNumbers.length > 0) {
        contact.phoneNumbers[0] = { countryCode, number };
      } else {
        contact.phoneNumbers = [{ countryCode, number }];
      }

      await contact.save();

      await logActivityToContact(contact._id, {
        action: "contact_phone_updated",
        type: "contact",
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

      // Check if email already exists for another contact
      const duplicateEmail = await Contact.findOne({
        _id: { $ne: contact_id },
        createdBy: req.user._id,
        emailAddresses: value,
      });

      if (duplicateEmail) {
        return res.status(400).json({
          status: "error",
          message: "This email already exists for another contact",
        });
      }

      // Update first email or add new if none exists
      if (contact.emailAddresses && contact.emailAddresses.length > 0) {
        contact.emailAddresses[0] = value;
      } else {
        contact.emailAddresses = [value];
      }

      await contact.save();

      await logActivityToContact(contact._id, {
        action: "contact_email_updated",
        type: "contact",
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
    console.error("Error updating phone/email:", error);
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
    const { contact_id, category } = req.body;

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

    if (category == "lead") {
      // Find the lead
      const lead = await Lead.findOne({
        _id: contact_id,
        createdBy: req.user._id,
      });
      if (!lead) {
        return res.status(404).json({
          status: "error",
          message: "Lead not found or unauthorized",
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
        }
        catch (error) {
          console.error(`S3 upload failed for ${file.originalname}:`, error);
          throw new Error("File upload failed");
        }
      };
      // Process uploaded files
      const newAttachments = [];
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try {
            const fileURL = await uploadFileToS3(file);
            const attachment = {
              attachment_id: new mongoose.Types.ObjectId(),
              fileName: file.originalname,
              fileURL,
              fileSize: file.size,
              fileType: file.mimetype,
              uploadedAt: new Date(),
            };
            newAttachments.push(attachment);
          } catch (error) {
            console.error(`Failed to upload file ${file.originalname}:`, error);
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
          console.error("Error parsing existingAttachments:", error);
          existingAttachments = [];
        }
      }
      // Combine existing and new attachments
      const allAttachments = [...existingAttachments, ...newAttachments];
      // Update lead with new attachments array
      lead.attachments = allAttachments;
      await lead.save();
      // Log activity
      await logActivityToContact(lead._id, {
        action: "attachments_updated",
        type: "lead",
        title: "Attachments Updated",
        description: `Updated attachments (${allAttachments.length} total, ${newAttachments.length} newly added)`,
      });
      return res.status(200).json({
        status: "success",
        message: "Attachments updated successfully",
        data: {
          contact_id: lead.contact_id,
          attachments: lead.attachments,
          newAttachmentsCount: newAttachments.length,
          totalAttachmentsCount: allAttachments.length,
        },
      });
    } else if (category == "contact") {
      const contact = await Contact.findOne({
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
          console.error(`S3 upload failed for ${file.originalname}:`, error);
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
            console.error(`Failed to upload file ${file.originalname}:`, error);
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
          console.error("Error parsing existingAttachments:", error);
          existingAttachments = [];
        }
      }

      // Combine existing and new attachments
      const allAttachments = [...existingAttachments, ...newAttachments];

      // Update contact with new attachments array
      contact.attachments = allAttachments;
      await contact.save();

      // Log activity
      await logActivityToContact(contact._id, {
        action: "attachments_updated",
        type: "contact",
        title: "Attachments Updated",
        description: `Updated attachments (${allAttachments.length} total, ${newAttachments.length} newly added)`,
      });

      return res.status(200).json({
        status: "success",
        message: "Attachments updated successfully",
        data: {
          contact_id: contact.contact_id,
          attachments: contact.attachments,
          newAttachmentsCount: newAttachments.length,
          totalAttachmentsCount: allAttachments.length,
        },
      });
    } else {
      // Try to find in contacts first
      let contact =
        (await Contact
          .findOne({
            _id: contact_id,
            createdBy: req.user._id,
          })) ||
        (await Lead.findOne({
          _id: contact_id,
          createdBy: req.user._id,
        }));
      if (!contact) {
        return res.status(404).json({
          status: "error",
          message: "Record not found or unauthorized",
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
        }
        catch (error) {
          console.error(`S3 upload failed for ${file.originalname}:`, error);
          throw new Error("File upload failed");
        }
      };
      // Process uploaded files
      const newAttachments = [];
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try {
            const fileURL = await uploadFileToS3(file);
            const attachment = {
              attachment_id: new mongoose.Types.ObjectId(),
              fileName: file.originalname,
              fileURL,
              fileSize: file.size,
              fileType: file.mimetype,
              uploadedAt: new Date(),
            };
            newAttachments.push(attachment);
          }
          catch (error) {
            console.error(`Failed to upload file ${file.originalname}:`, error);
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
          console.error("Error parsing existingAttachments:", error);
          existingAttachments = [];
        }
      }
      // Combine existing and new attachments
      const allAttachments = [...existingAttachments, ...newAttachments];
      // Update contact/lead with new attachments array
      contact.attachments = allAttachments;
      await contact.save();
      // Log activity
      await logActivityToContact(contact._id, {
        action: "attachments_updated",
        type: contact.isLead ? "lead" : "contact",
        title: "Attachments Updated",
        description: `Updated attachments (${allAttachments.length} total, ${newAttachments.length} newly added)`,
      });
      return res.status(200).json({
        status: "success",
        message: "Attachments updated successfully",
        data: {
          contact_id: contact.contact_id,
          attachments: contact.attachments,
          newAttachmentsCount: newAttachments.length,
          totalAttachmentsCount: allAttachments.length,
        },
      });
    }
  } catch (error) {
    console.error("Error updating attachments:", error);
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
