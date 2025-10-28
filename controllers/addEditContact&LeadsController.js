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
//             firstName,
//             lastName,
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
//                 firstName,
//                 lastName,
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
//                 description: `${firstName || ""} ${lastName || ""}`.trim(),
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
//                 firstName,
//                 lastName,
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
//                         description: `${contact.firstName || ""} ${contact.lastName || ""}`,
//                     });
//                 } else {
//                     await logActivityToContact(contact._id, {
//                         action: "isLead_converted_to_contact",
//                         type: "contact",
//                         title: "isLead Converted to Contact",
//                         description: `${contact.firstName || ""} ${contact.lastName || ""}`,
//                     });
//                 }
//             } else {
//                 await logActivityToContact(contact._id, {
//                     action: isLead ? "isLead_updated" : "contact_updated",
//                     type: "contact",
//                     title: isLead ? "isLead Updated" : "Contact Updated",
//                     description: `${contact.firstName || ""} ${contact.lastName || ""}`,
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

const addEditContactisLeads = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user)
      return res.status(401).json({ status: "error", message: "Unauthorized: User not found" });

    // NOTE: read raw values from req.body (multer/form-data gives strings)
    const {
      contact_id,
      firstName,
      lastName,
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

    // parse booleans safely
    const isLead = parseBoolean(req.body.isLead);
    const isFavourite = parseBoolean(req.body.isFavourite);

    // ---------- Parse Email Addresses ----------
    let cleanedEmails = [];
    if (emailAddresses) {
      try {
        const parsed = typeof emailAddresses === "string" ? JSON.parse(emailAddresses) : emailAddresses;
        cleanedEmails = Array.isArray(parsed) ? parsed.filter((e) => e && e.trim() !== "") : [parsed];
      } catch {
        cleanedEmails = typeof emailAddresses === "string" ? [emailAddresses.trim()] : [];
      }
    }

    // ---------- Parse Phone Numbers ----------
    let formattedPhones = [];
    if (phoneNumbers) {
      try {
        const parsed = typeof phoneNumbers === "string" ? JSON.parse(phoneNumbers) : phoneNumbers;
        formattedPhones = Array.isArray(parsed)
          ? parsed.map((p) => ({
              countryCode: String(p.countryCode || p.countrycode || "").replace(/[^\d]/g, ""),
              number: String(p.number || "").replace(/[^\d]/g, ""),
            }))
          : [];
      } catch (err) {
        console.error("Phone parse error:", err);
        formattedPhones = [];
      }
    }

    // ---------- Duplicate check ----------
    if (cleanedEmails.length > 0 || formattedPhones.length > 0) {
      const query = { createdBy: req.user._id, $or: [] };
      if (contact_id && mongoose.Types.ObjectId.isValid(contact_id)) query._id = { $ne: contact_id };
      if (cleanedEmails.length) query.$or.push({ emailAddresses: { $in: cleanedEmails } });
      formattedPhones.forEach((p) =>
        query.$or.push({ phoneNumbers: { $elemMatch: { countryCode: p.countryCode, number: p.number } } })
      );
      if (query.$or.length > 0) {
        const duplicate = await Contact.findOne(query);
        if (duplicate) {
          return res.status(400).json({
            status: "error",
            message: "A contact or lead with the same phone or email already exists.",
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
    const isCreating = !contact_id || contact_id === "0";
    let contact;

    if (isCreating) {
      contact = await Contact.create({
        firstName,
        lastName,
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
        description: `${firstName || ""} ${lastName || ""}`.trim(),
      });
    } else {
      const existing = await Contact.findOne({ _id: contact_id, createdBy: req.user._id });
      if (!existing) return res.status(404).json({ status: "error", message: "Contact not found" });

      const prevIsLead = !!existing.isLead;

      const updates = {
        firstName,
        lastName,
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
          action: isLead ? "contact_converted_to_isLead" : "isLead_converted_to_contact",
          type: "contact",
          title: isLead ? "Contact Converted to Lead" : "Lead Converted to Contact",
          description: `${contact.firstName || ""} ${contact.lastName || ""}`,
        });
      } else {
        await logActivityToContact(contact._id, {
          action: isLead ? "isLead_updated" : "contact_updated",
          type: "contact",
          title: isLead ? "Lead Updated" : "Contact Updated",
          description: `${contact.firstName || ""} ${contact.lastName || ""}`,
        });
      }
    }

    // ---------- Return fresh contact ----------
    const freshContact = await Contact.findById(contact._id)
      .lean();

    const formatted = { ...freshContact, contact_id: freshContact._id };
    delete formatted._id;
    delete formatted.__v;
    delete formatted.updatedAt;
    delete formatted.createdBy;

    res.status(isCreating ? 201 : 200).json({
      status: "success",
      message: isLead ? (isCreating ? "Lead Created" : "Lead Updated") : (isCreating ? "Contact Created" : "Contact Updated"),
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

module.exports = { addEditContactisLeads };