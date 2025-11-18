// const mongoose = require("mongoose");
// const Contact = require("../models/contactModel");
// const User = require("../models/userModel");
// const s3 = require("../utils/s3");
// const { PutObjectCommand } = require("@aws-sdk/client-s3");
// const path = require("path");
// const { logActivityToContact } = require("../utils/activityLogger");

// const addEditContactisLeads = async (req, res) => {
//     try {
//         const user = await User.findById(req.user._id);
//         if (!user) {
//             return res.status(401).json({
//                 status: "error",
//                 message: "Unauthorized: User not found",
//             });
//         }

//         let {
//             contact_id,
//             firstname,
//             lastname,
//             company,
//             designation,
//             linkedin,
//             instagram,
//             telegram,
//             twitter,
//             facebook,
//             emailAddresses,
//             phoneNumbers,
//             countryCode,
//             isFavourite,
//             notes,
//             website,
//             isLead = false,
//         } = req.body;

//         // ✅ Format Email Addresses
//         let cleanedEmails = [];
//         if (emailAddresses) {
//             try {
//                 const parsed =
//                     typeof emailAddresses === "string"
//                         ? JSON.parse(emailAddresses)
//                         : emailAddresses;
//                 cleanedEmails = Array.isArray(parsed)
//                     ? parsed.filter((e) => e && e.trim() !== "")
//                     : [parsed];
//             } catch {
//                 cleanedEmails =
//                     typeof emailAddresses === "string"
//                         ? [emailAddresses.trim()]
//                         : [];
//             }
//         }

//         // ✅ Format Phone Numbers (Frontend sends `phoneNumbers` & `countryCode`)
//         let formattedPhones = [];
//         if (phoneNumbers && countryCode) {
//             try {
//                 const phoneArray = Array.isArray(phoneNumbers)
//                     ? phoneNumbers
//                     : JSON.parse(phoneNumbers);
//                 const codeArray = Array.isArray(countryCode)
//                     ? countryCode
//                     : JSON.parse(countryCode);

//                 formattedPhones = phoneArray.map((num, i) => ({
//                     countryCode: String(codeArray[i] || "").replace(/[^\d]/g, ""),
//                     number: String(num || "").replace(/[^\d]/g, ""),
//                 }));
//             } catch {
//                 // fallback (single)
//                 formattedPhones = [
//                     {
//                         countryCode: String(countryCode || "").replace(/[^\d]/g, ""),
//                         number: String(phoneNumbers || "").replace(/[^\d]/g, ""),
//                     },
//                 ];
//             }
//         }

//         // ✅ Check for duplicate contact
//         if (cleanedEmails.length > 0 || formattedPhones.length > 0) {
//             const query = { createdBy: req.user._id, $or: [] };

//             if (contact_id && mongoose.Types.ObjectId.isValid(contact_id)) {
//                 query._id = { $ne: contact_id };
//             }

//             if (cleanedEmails.length)
//                 query.$or.push({ emailAddresses: { $in: cleanedEmails } });

//             formattedPhones.forEach((p) => {
//                 query.$or.push({
//                     phoneNumbers: {
//                         $elemMatch: { countryCode: p.countryCode, number: p.number },
//                     },
//                 });
//             });

//             if (query.$or.length > 0) {
//                 const duplicate = await Contact.findOne(query);
//                 if (duplicate) {
//                     return res.status(400).json({
//                         status: "error",
//                         message:
//                             "A contact or isLead with the same phone number or email already exists.",
//                     });
//                 }
//             }
//         }

//         // // ✅ Upload Image (if provided)
//         // let contactImageURL = "";
//         // if (req.file) {
//         //   const ext = path.extname(req.file.originalname);
//         //   const fileName = `contactImages/${Date.now()}_${path.basename(
//         //     req.file.originalname,
//         //     ext
//         //   )}${ext}`;

//         //   const params = {
//         //     Bucket: process.env.AWS_BUCKET_NAME,
//         //     Key: fileName,
//         //     Body: req.file.buffer,
//         //     ContentType: req.file.mimetype,
//         //   };
//         //   await s3.send(new PutObjectCommand(params));

//         //   contactImageURL = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
//         // }

//         // ---------- Upload Image ----------

//         const uploadImageToS3 = async (file) => {
//             const ext = path.extname(file.originalname);
//             const name = path.basename(file.originalname, ext);
//             const fileName = `contactImages/${name}_${Date.now()}${ext}`;
//             const params = {
//                 Bucket: process.env.AWS_BUCKET_NAME,
//                 Key: fileName,
//                 Body: file.buffer,
//                 ContentType: file.mimetype,
//             };
//             try {
//                 await s3.send(new PutObjectCommand(params));
//                 return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
//             } catch (error) {
//                 console.error("S3 upload failed:", error);
//                 throw new Error("Image upload failed");
//             }
//         };

//         let contactImage = "";
//         if (req.file) {
//             contactImage = await uploadImageToS3(req.file);
//         }

//         // ✅ Create or Update Contact/isLead
//         const isCreating = !contact_id || contact_id === "0";
//         let contact;

//         if (isCreating) {
//             // ---- CREATE NEW CONTACT / isLead ----
//             contact = await Contact.create({
//                 firstname,
//                 lastname,
//                 company,
//                 designation,
//                 linkedin,
//                 instagram,
//                 telegram,
//                 twitter,
//                 facebook,
//                 emailAddresses: cleanedEmails,
//                 phoneNumbers: formattedPhones,
//                 contactImageURL : contactImage,
//                 isFavourite,
//                 notes,
//                 website,
//                 isLead: Boolean(isLead),
//                 createdBy: req.user._id,
//             });

//             await logActivityToContact(contact._id, {
//                 action: isLead ? "isLead_created" : "contact_created",
//                 type: "contact",
//                 title: isLead ? "isLead Created" : "Contact Created",
//                 description: `${firstname || ""} ${lastname || ""}`.trim(),
//             });
//         } else {
//             // ---- UPDATE EXISTING CONTACT / isLead ----
//             const existing = await Contact.findOne({
//                 _id: contact_id,
//                 createdBy: req.user._id,
//             });

//             if (!existing) {
//                 return res.status(404).json({
//                     status: "error",
//                     message: "Contact not found or unauthorized",
//                 });
//             }

//             const previsLead = existing.isLead;

//             const updates = {
//                 firstname,
//                 lastname,
//                 company,
//                 designation,
//                 linkedin,
//                 instagram,
//                 telegram,
//                 twitter,
//                 facebook,
//                 isFavourite,
//                 notes,
//                 website,
//                 isLead: Boolean(isLead),
//             };

//             if (cleanedEmails.length) updates.emailAddresses = cleanedEmails;
//             if (formattedPhones.length) updates.phoneNumbers = formattedPhones;
//             if (contactImage) updates.contactImageURL = contactImage;

//             contact = await Contact.findOneAndUpdate(
//                 { _id: contact_id, createdBy: req.user._id },
//                 updates,
//                 { new: true }
//             );

//             // ✅ Log Conversion or Update
//             if (previsLead !== isLead) {
//                 if (isLead) {
//                     await logActivityToContact(contact._id, {
//                         action: "contact_converted_to_isLead",
//                         type: "contact",
//                         title: "Contact Converted to isLead",
//                         description: `${contact.firstname || ""} ${contact.lastname || ""}`,
//                     });
//                 } else {
//                     await logActivityToContact(contact._id, {
//                         action: "isLead_converted_to_contact",
//                         type: "contact",
//                         title: "isLead Converted to Contact",
//                         description: `${contact.firstname || ""} ${contact.lastname || ""}`,
//                     });
//                 }
//             } else {
//                 await logActivityToContact(contact._id, {
//                     action: isLead ? "isLead_updated" : "contact_updated",
//                     type: "contact",
//                     title: isLead ? "isLead Updated" : "Contact Updated",
//                     description: `${contact.firstname || ""} ${contact.lastname || ""}`,
//                 });
//             }
//         }

//         // ✅ Format Response
//         const formatted = contact.toObject();
//         formatted.contact_id = formatted._id;
//         delete formatted._id;
//         delete formatted.createdBy;
//         delete formatted.__v;
//         delete formatted.updatedAt;

//         res.status(isCreating ? 201 : 200).json({
//             status: "success",
//             message: isLead
//                 ? isCreating
//                     ? "isLead Created"
//                     : "isLead Updated"
//                 : isCreating
//                     ? "Contact Created"
//                     : "Contact Updated",
//             data: formatted,
//         });
//     } catch (error) {
//         console.error("Error in addEditContactisLeads:", error);
//         res.status(500).json({
//             status: "error",
//             message: "Internal server error",
//             error: error.message,
//         });
//     }
// };

// module.exports = { addEditContactisLeads };

const mongoose = require("mongoose");
const Contact = require("../models/contactModel");
// const Lead = require("../models/leadModel");
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

// ✅ Unified add/edit for Contact and Lead
// const addEditContactisLeads = async (req, res) => {
//   try {
//     const user = await User.findById(req.user._id);
//     if (!user)
//       return res
//         .status(401)
//         .json({ status: "error", message: "Unauthorized: User not found" });

//     // ---------- Extract request fields ----------
//     const {
//       contact_id,
//       firstname,
//       lastname,
//       company,
//       designation,
//       linkedin,
//       instagram,
//       telegram,
//       twitter,
//       facebook,
//       emailAddresses,
//       phoneNumbers,
//       notes,
//       website,
//       category, // <-- new field
//     } = req.body;

//     const isLead = parseBoolean(req.body.isLead);
//     const isFavourite = parseBoolean(req.body.isFavourite);

//     // ---------- Parse emailAddresses ----------
//     let cleanedEmails = [];
//     if (emailAddresses) {
//       try {
//         const parsed =
//           typeof emailAddresses === "string"
//             ? JSON.parse(emailAddresses)
//             : emailAddresses;
//         cleanedEmails = Array.isArray(parsed)
//           ? parsed.filter((e) => e && e.trim() !== "")
//           : [parsed];
//       } catch {
//         cleanedEmails =
//           typeof emailAddresses === "string" ? [emailAddresses.trim()] : [];
//       }
//     }

//     // ---------- Parse phoneNumbers ----------
//     let formattedPhones = [];
//     if (phoneNumbers) {
//       try {
//         const parsed =
//           typeof phoneNumbers === "string"
//             ? JSON.parse(phoneNumbers)
//             : phoneNumbers;
//         formattedPhones = Array.isArray(parsed)
//           ? parsed.map((p) => ({
//               countryCode: String(p.countryCode || p.countrycode || "").replace(
//                 /[^\d]/g,
//                 ""
//               ),
//               number: String(p.number || "").replace(/[^\d]/g, ""),
//             }))
//           : [];
//       } catch (err) {
//         console.error("Phone parse error:", err);
//       }
//     }

//     // ---------- Basic validations ----------
//     if (!firstname || firstname.trim() === "")
//       return res
//         .status(400)
//         .json({ status: "error", message: "First name is required" });

//     if (!cleanedEmails?.length)
//       return res
//         .status(400)
//         .json({ status: "error", message: "At least one email address required" });

//     if (!formattedPhones?.length)
//       return res
//         .status(400)
//         .json({ status: "error", message: "At least one phone number required" });

//     if (!category || !["contact", "lead"].includes(category.toLowerCase()))
//       return res.status(400).json({
//         status: "error",
//         message: "Category must be either 'contact' or 'lead'",
//       });

//     // ---------- Upload image to S3 if provided ----------
//     const uploadImageToS3 = async (file) => {
//       const ext = path.extname(file.originalname);
//       const name = path.basename(file.originalname, ext);
//       const fileName = `contactImages/${name}_${Date.now()}${ext}`;
//       const params = {
//         Bucket: process.env.AWS_BUCKET_NAME,
//         Key: fileName,
//         Body: file.buffer,
//         ContentType: file.mimetype,
//       };
//       await s3.send(new PutObjectCommand(params));
//       return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
//     };

//     let contactImageURL = "";
//     if (req.file) contactImageURL = await uploadImageToS3(req.file);

//     const isCreating = !contact_id || contact_id === "0";
//     const currentModel =
//       category.toLowerCase() === "lead" ? Lead : Contact;
//     const oppositeModel =
//       category.toLowerCase() === "lead" ? Contact : Lead;

//     let contact;

//     // =========================================================
//     // =============== CREATE NEW CONTACT/LEAD =================
//     // =========================================================
//     if (isCreating) {
//       contact = await currentModel.create({
//         firstname,
//         lastname,
//         company,
//         designation,
//         linkedin,
//         instagram,
//         telegram,
//         twitter,
//         facebook,
//         emailAddresses: cleanedEmails,
//         phoneNumbers: formattedPhones,
//         contactImageURL,
//         isFavourite,
//         notes,
//         website,
//         isLead: category === "lead",
//         createdBy: req.user._id,
//       });

//       contact.contact_id = contact._id; // maintain reference
//       await contact.save();

//       await logActivityToContact(contact._id, {
//         action: category === "lead" ? "lead_created" : "contact_created",
//         type: "contact",
//         title: category === "lead" ? "Lead Created" : "Contact Created",
//         description: `${firstname || ""} ${lastname || ""}`.trim(),
//       });
//     }

//     // =========================================================
//     // =============== UPDATE EXISTING CONTACT =================
//     // =========================================================
//     else {
//       let existing =
//         (await Contact.findOne({ contact_id })) ||
//         (await Lead.findOne({ contact_id }));

//       if (!existing)
//         return res
//           .status(404)
//           .json({ status: "error", message: "Record not found" });

//       const prevCategory = existing.isLead ? "lead" : "contact";
//       const newCategory = category.toLowerCase();

//       const updates = {
//         firstname,
//         lastname,
//         company,
//         designation,
//         linkedin,
//         instagram,
//         telegram,
//         twitter,
//         facebook,
//         emailAddresses: cleanedEmails,
//         phoneNumbers: formattedPhones,
//         contactImageURL: contactImageURL || existing.contactImageURL,
//         isFavourite,
//         notes,
//         website,
//         isLead: newCategory === "lead",
//       };

//       // If category changed → Move document between collections
//       if (prevCategory !== newCategory) {
//         // 1️⃣ Remove from old collection
//         await existing.deleteOne();

//         // 2️⃣ Create in new collection but retain the same contact_id
//         contact = newCategory === "lead"
//           ? new Lead({ ...updates, contact_id, createdBy: req.user._id })
//           : new Contact({ ...updates, contact_id, createdBy: req.user._id });

//         await contact.save();

//         await logActivityToContact(contact.contact_id, {
//           action:
//             newCategory === "lead"
//               ? "contact_converted_to_lead"
//               : "lead_converted_to_contact",
//           type: "contact",
//           title:
//             newCategory === "lead"
//               ? "Contact Converted to Lead"
//               : "Lead Converted to Contact",
//           description: `${firstname || ""} ${lastname || ""}`.trim(),
//         });
//       } else {
//         // Update within same collection
//         contact = await currentModel.findOneAndUpdate(
//           { contact_id },
//           updates,
//           { new: true }
//         );

//         await logActivityToContact(contact.contact_id, {
//           action:
//             newCategory === "lead" ? "lead_updated" : "contact_updated",
//           type: "contact",
//           title:
//             newCategory === "lead" ? "Lead Updated" : "Contact Updated",
//           description: `${firstname || ""} ${lastname || ""}`.trim(),
//         });
//       }
//     }

//     // ---------- Final Response ----------
//     const freshContact = await currentModel
//       .findOne({ contact_id: contact.contact_id })
//       .lean();

//     const formatted = {
//       ...freshContact,
//       contact_id: freshContact.contact_id,
//     };
//     delete formatted.__v;
//     delete formatted.updatedAt;
//     delete formatted.createdBy;

//     res.status(isCreating ? 201 : 200).json({
//       status: "success",
//       message:
//         category === "lead"
//           ? isCreating
//             ? "Lead Created"
//             : "Lead Updated"
//           : isCreating
//           ? "Contact Created"
//           : "Contact Updated",
//       data: formatted,
//     });
//   } catch (error) {
//     console.error("Error in addEditContactisLeads:", error);
//     res.status(500).json({
//       status: "error",
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };

const addEditContactisLeads = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user)
      return res
        .status(401)
        .json({ status: "error", message: "Unauthorized: User not found" });

    // NOTE: read raw values from req.body (multer/form-data gives strings)
    const {
      contact_id,
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
      phoneNumbers, // frontend sends JSON string
      notes,
      website,
    } = req.body;

    console.log("isLead:", req.body.isLead, "category:", req.body.category);
    // parse booleans safely
    const isLead = parseBoolean(req.body.isLead);
    const isFavourite = parseBoolean(req.body.isFavourite);

    // ---------- Parse Email Addresses ----------
    let cleanedEmails = [];
    if (emailAddresses) {
      try {
        const parsed =
          typeof emailAddresses === "string"
            ? JSON.parse(emailAddresses)
            : emailAddresses;
        cleanedEmails = Array.isArray(parsed)
          ? parsed.filter((e) => e && e.trim() !== "")
          : [parsed];
      } catch {
        cleanedEmails =
          typeof emailAddresses === "string" ? [emailAddresses.trim()] : [];
      }
    }

    // ---------- Parse Phone Numbers ----------
    let formattedPhones = [];
    if (phoneNumbers) {
      try {
        const parsed =
          typeof phoneNumbers === "string"
            ? JSON.parse(phoneNumbers)
            : phoneNumbers;
        formattedPhones = Array.isArray(parsed)
          ? parsed.map((p) => ({
              countryCode: String(p.countryCode || p.countrycode || "").replace(
                /[^\d]/g,
                ""
              ),
              number: String(p.number || "").replace(/[^\d]/g, ""),
            }))
          : [];
      } catch (err) {
        console.error("Phone parse error:", err);
        formattedPhones = [];
      }
    }

    // ---------- Validation for BOTH creation and update ----------
    const isCreating = !contact_id || contact_id === "0";

    // Check if firstname is provided
    if (!firstname || firstname.trim() === "") {
      return res.status(400).json({
        status: "error",
        message: "First name is required",
      });
    }

    // Check if at least one email is provided
    if (!cleanedEmails || cleanedEmails.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "At least one email address is required",
      });
    }

    // Check if at least one phone number is provided
    if (!formattedPhones || formattedPhones.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "At least one phone number is required",
      });
    }

    // ---------- Duplicate check ----------
    if (cleanedEmails.length > 0 || formattedPhones.length > 0) {
      const query = { createdBy: req.user._id, $or: [] };
      if (contact_id && mongoose.Types.ObjectId.isValid(contact_id))
        query._id = { $ne: contact_id };
      if (cleanedEmails.length)
        query.$or.push({ emailAddresses: { $in: cleanedEmails } });
      formattedPhones.forEach((p) =>
        query.$or.push({
          phoneNumbers: {
            $elemMatch: { countryCode: p.countryCode, number: p.number },
          },
        })
      );
      if (query.$or.length > 0) {
        const duplicate = await Contact.findOne(query);
        if (duplicate) {
          return res.status(400).json({
            status: "error",
            message:
              "A contact or lead with the same phone or email already exists.",
          });
        }
      }
    }

    // ---------- Upload Image to S3 (if any) ----------
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

    let contactImageURL = "";
    if (req.file) contactImageURL = await uploadImageToS3(req.file);

    // ---------- Create or Update ----------
    let contact;

    if (isCreating) {
      contact = await Contact.create({
        firstname,
        lastname,
        company,
        designation,
        linkedin,
        instagram,
        telegram,
        twitter,
        facebook,
        emailAddresses: cleanedEmails,
        phoneNumbers: formattedPhones,
        contactImageURL,
        isFavourite,
        notes,
        website,
        isLead: Boolean(isLead), // now parsed boolean
        createdBy: req.user._id,
      });

      // ensure contact_id unique field is set (if your schema uses contact_id)
      try {
        contact.contact_id = contact._id;
        await contact.save();
      } catch (err) {
        // ignore if schema doesn't have contact_id or if it's not needed
        console.warn("Could not set contact_id:", err.message);
      }

      await logActivityToContact(contact._id, {
        action: isLead ? "isLead_created" : "contact_created",
        type: "contact",
        title: isLead ? "Lead Created" : "Contact Created",
        description: `${firstname || ""} ${lastname || ""}`.trim(),
      });
    } else {
      const existing = await Contact.findOne({
        _id: contact_id,
        createdBy: req.user._id,
      });
      if (!existing)
        return res
          .status(404)
          .json({ status: "error", message: "Contact not found" });

      const prevIsLead = !!existing.isLead;

      const updates = {
        firstname,
        lastname,
        company,
        designation,
        linkedin,
        instagram,
        telegram,
        twitter,
        facebook,
        isFavourite,
        notes,
        website,
        isLead: Boolean(isLead), // ensure boolean
      };

      if (cleanedEmails.length) updates.emailAddresses = cleanedEmails;
      if (formattedPhones.length) updates.phoneNumbers = formattedPhones;
      if (contactImageURL) updates.contactImageURL = contactImageURL;

      contact = await Contact.findOneAndUpdate(
        { _id: contact_id, createdBy: req.user._id },
        updates,
        { new: true }
      );

      // Activity log
      if (prevIsLead !== Boolean(isLead)) {
        await logActivityToContact(contact._id, {
          action: isLead
            ? "contact_converted_to_isLead"
            : "isLead_converted_to_contact",
          type: "contact",
          title: isLead
            ? "Contact Converted to Lead"
            : "Lead Converted to Contact",
          description: `${contact.firstname || ""} ${contact.lastname || ""}`,
        });
      } else {
        await logActivityToContact(contact._id, {
          action: isLead ? "isLead_updated" : "contact_updated",
          type: "contact",
          title: isLead ? "Lead Updated" : "Contact Updated",
          description: `${contact.firstname || ""} ${contact.lastname || ""}`,
        });
      }
    }

    // ---------- Return fresh contact ----------
    const freshContact = await Contact.findById(contact._id).lean();

    const formatted = { ...freshContact, contact_id: freshContact._id };
    delete formatted._id;
    delete formatted.__v;
    delete formatted.updatedAt;
    delete formatted.createdBy;

    res.status(isCreating ? 201 : 200).json({
      status: "success",
      message: isLead
        ? isCreating
          ? "Lead Created"
          : "Lead Updated"
        : isCreating
        ? "Contact Created"
        : "Contact Updated",
      data: formatted,
    });
  } catch (error) {
    console.error("Error in addEditContactisLeads:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

const deleteContactOrLead = async (req, res) => {
  try {
    const { contact_id } = req.body;
    const userId = req.user._id;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required",
      });
    }

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

    res.status(200).json({
      status: "success",
      message: contact.isLead
        ? "Lead deleted successfully"
        : "Contact deleted successfully",
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

    const { contact_id, isFavourite } = req.body;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "Contact ID is required",
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
        contact_id: contact._id,
        isFavourite: contact.isFavourite,
      },
    });
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
    const { contact_id } = req.body;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required",
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
        contact_id: contact._id,
        attachments: contact.attachments,
        newAttachmentsCount: newAttachments.length,
        totalAttachmentsCount: allAttachments.length,
      },
    });
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
