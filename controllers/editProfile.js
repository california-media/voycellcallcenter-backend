// const path = require("path");
// const mongoose = require("mongoose");
// const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
// const User = require("../models/userModel");
// const { parsePhoneNumberFromString } = require("libphonenumber-js");
// const s3 = require("../utils/s3");

// const uploadImageToS3 = async (file) => {
//   const ext = path.extname(file.originalname);
//   const name = path.basename(file.originalname, ext);
//   const fileName = `profileImages/${name}_${Date.now()}${ext}`;

//   const params = {
//     Bucket: process.env.AWS_BUCKET_NAME,
//     Key: fileName,
//     Body: file.buffer,
//     ContentType: file.mimetype,
//   };

//   const command = new PutObjectCommand(params);
//   await s3.send(command);

//   return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
// };

// const deleteImageFromS3 = async (imageUrl) => {
//   try {
//     if (!imageUrl) return;

//     // Extract the Key from the URL
//     const urlParts = imageUrl.split(".amazonaws.com/");
//     if (urlParts.length < 2) return; // not a valid S3 URL

//     const fileKey = urlParts[1]; // profileImages/filename.jpg

//     const params = {
//       Bucket: process.env.AWS_BUCKET_NAME,
//       Key: fileKey,
//     };

//     const command = new DeleteObjectCommand(params);
//     await s3.send(command);

//     console.log(`✅ Deleted from S3: ${fileKey}`);
//   } catch (err) {
//     console.error("Failed to delete from S3:", err);
//   }
// };

// const editProfile = async (req, res) => {
//   try {
//     const userId = req.user._id;
//     const {
//       firstname,
//       lastname,
//       email,
//       // phonenumber,
//       // countryCode,
//       linkedin,
//       instagram,
//       telegram,
//       twitter,
//       facebook,
//       designation,
//       whatsappTemplate_id,
//       whatsappTemplateTitle,
//       whatsappTemplateMessage,
//       whatsappTemplateIsFavourite,
//       emailTemplate_id,
//       emailTemplateTitle,
//       emailTemplateSubject,
//       emailTemplateBody,
//       emailTemplateIsFavourite,
//       apiType = "web", // default to web if not provided
//     } = req.body;

//     const user = await User.findById(userId);
//     if (!user) {
//       return res
//         .status(404)
//         .json({ status: "error", message: "User not found" });
//     }

//     let updatedWhatsappTemplate;
//     let updatedEmailTemplate;

//     // === WhatsApp Template Edit ===
//     if (whatsappTemplate_id) {
//       const index = user.whatsappTemplates.findIndex(
//         (tpl) =>
//           tpl.whatsappTemplate_id?.toString() === whatsappTemplate_id.toString()
//       );

//       if (index !== -1) {
//         if (whatsappTemplateTitle)
//           user.whatsappTemplates[index].whatsappTemplateTitle =
//             whatsappTemplateTitle;
//         if (whatsappTemplateMessage)
//           user.whatsappTemplates[index].whatsappTemplateMessage =
//             whatsappTemplateMessage;
//         if (typeof whatsappTemplateIsFavourite !== "undefined") {
//           user.whatsappTemplates[index].whatsappTemplateIsFavourite =
//             whatsappTemplateIsFavourite;
//         }
//         updatedWhatsappTemplate = user.whatsappTemplates[index];
//       } else {
//         return res
//           .status(404)
//           .json({ status: "error", message: "WhatsApp template not found" });
//       }
//     }

//     // === WhatsApp Template Add ===
//     if (
//       !whatsappTemplate_id &&
//       whatsappTemplateTitle &&
//       whatsappTemplateMessage
//     ) {
//       const newWhatsappTemplate = {
//         whatsappTemplate_id: new mongoose.Types.ObjectId(),
//         whatsappTemplateTitle,
//         whatsappTemplateMessage,
//         whatsappTemplateIsFavourite: !!whatsappTemplateIsFavourite,
//       };
//       user.whatsappTemplates.unshift(newWhatsappTemplate);
//       updatedWhatsappTemplate = newWhatsappTemplate;
//     }

//     // === Email Template Edit ===
//     if (emailTemplate_id) {
//       const index = user.emailTemplates.findIndex(
//         (tpl) =>
//           tpl.emailTemplate_id?.toString() === emailTemplate_id.toString()
//       );

//       if (index !== -1) {
//         if (emailTemplateTitle)
//           user.emailTemplates[index].emailTemplateTitle = emailTemplateTitle;
//         if (emailTemplateSubject)
//           user.emailTemplates[index].emailTemplateSubject =
//             emailTemplateSubject;
//         if (emailTemplateBody)
//           user.emailTemplates[index].emailTemplateBody = emailTemplateBody;
//         if (typeof emailTemplateIsFavourite !== "undefined") {
//           user.emailTemplates[index].emailTemplateIsFavourite =
//             emailTemplateIsFavourite;
//         }
//         updatedEmailTemplate = user.emailTemplates[index];
//       } else {
//         return res
//           .status(404)
//           .json({ status: "error", message: "Email template not found" });
//       }
//     }

//     // === Email Template Add ===
//     if (
//       !emailTemplate_id &&
//       emailTemplateTitle &&
//       emailTemplateSubject &&
//       emailTemplateBody
//     ) {
//       const newEmailTemplate = {
//         emailTemplate_id: new mongoose.Types.ObjectId(),
//         emailTemplateTitle,
//         emailTemplateSubject,
//         emailTemplateBody,
//         emailTemplateIsFavourite: !!emailTemplateIsFavourite,
//       };
//       user.emailTemplates.unshift(newEmailTemplate);
//       updatedEmailTemplate = newEmailTemplate;
//     }

//     // === Update Basic Info ===
//     if (
//       !whatsappTemplate_id &&
//       !emailTemplate_id &&
//       !whatsappTemplateTitle &&
//       !emailTemplateTitle
//     ) {
//       const keys = Object.keys(req.body);

//       if (keys.includes("firstname")) user.firstname = firstname;
//       if (keys.includes("lastname")) user.lastname = lastname;
//       if (keys.includes("linkedin")) user.linkedin = linkedin;
//       if (keys.includes("instagram")) user.instagram = instagram;
//       if (keys.includes("telegram")) user.telegram = telegram;
//       if (keys.includes("twitter")) user.twitter = twitter;
//       if (keys.includes("facebook")) user.facebook = facebook;
//       if (keys.includes("designation")) user.designation = designation;

//       if (keys.includes("email") && email) {
//         const trimmedEmail = email.trim().toLowerCase();

//         if (["email", "google", "linkedin"].includes(user.signupMethod)) {
//           // ✅ If same email, allow silently
//           if (trimmedEmail === user.email) {
//             // no change, continue
//           } else {
//             return res.status(400).json({
//               status: "error",
//               message: "You cannot change email for this account.",
//             });
//           }
//         } else {
//           // Only check duplicates if signupMethod != email|google|linkedin
//           const existingUser = await User.findOne({
//             email: trimmedEmail,
//             _id: { $ne: user._id },
//           });
//           if (existingUser) {
//             return res.status(400).json({
//               status: "error",
//               message: "This email is already used.",
//             });
//           }
//           user.email = trimmedEmail;
//         }
//       }

//       if (apiType === "mobile") {
//         if (req.body.countryCode && req.body.phonenumber) {
//           const newNumberObj = {
//             countryCode: String(req.body.countryCode).replace(/\D/g, ""),
//             number: String(req.body.phonenumber).replace(/\D/g, ""),
//           };

//           if (user.signupMethod === "phoneNumber") {
//             // ✅ If same number, allow silently
//             const currentPhone = user.phonenumbers?.[0];
//             if (
//               currentPhone &&
//               currentPhone.countryCode === newNumberObj.countryCode &&
//               currentPhone.number === newNumberObj.number
//             ) {
//               // same number, continue
//             } else {
//               return res.status(400).json({
//                 status: "error",
//                 message: "You cannot change phone number for this account.",
//               });
//             }
//           } else {
//             // check duplicates for other signup methods
//             const existingPhoneUser = await User.findOne({
//               phonenumbers: { $elemMatch: newNumberObj },
//               _id: { $ne: user._id },
//             });

//             if (existingPhoneUser) {
//               return res.status(400).json({
//                 status: "error",
//                 message: "This phone number is already used.",
//               });
//             }

//             user.phonenumbers = [newNumberObj];
//           }
//         }
//       } else if (apiType === "web") {
//         if (req.body.phonenumber) {
//           let rawNumber = req.body.phonenumber.trim();
//           if (!rawNumber.startsWith("+")) rawNumber = "+" + rawNumber;

//           const phoneObj = parsePhoneNumberFromString(rawNumber);
//           if (!phoneObj || !phoneObj.isValid()) {
//             return res.status(400).json({
//               status: "error",
//               message: "Invalid phone number format",
//             });
//           }

//           const newNumberObj = {
//             countryCode: phoneObj.countryCallingCode,
//             number: phoneObj.nationalNumber,
//           };

//           if (user.signupMethod === "phoneNumber") {
//             // ✅ If same number, allow silently

//             const currentPhone = user.phonenumbers?.[0];
//             if (
//               currentPhone &&
//               currentPhone.countryCode === newNumberObj.countryCode &&
//               currentPhone.number === newNumberObj.number
//             ) {
//               // same number, continue
//             } else {
//               return res.status(400).json({
//                 status: "error",
//                 message: "You cannot change phone number for this account.",
//               });
//             }
//           } else {
//             // ✅ Duplicate check for other signup methods
//             const existingPhoneUser = await User.findOne({
//               phonenumbers: { $elemMatch: newNumberObj },
//               _id: { $ne: user._id },
//             });

//             if (existingPhoneUser) {
//               return res.status(400).json({
//                 status: "error",
//                 message: "This phone number is already used.",
//               });
//             }

//             user.phonenumbers = [newNumberObj];
//           }
//         }
//       }

//       if (keys.includes("profileImage")) {
//         // If client sends blank, remove the image
//         if (!req.body.profileImage || req.body.profileImage.trim() === "") {
//           await deleteImageFromS3(user.profileImageURL);
//           user.profileImageURL = "";
//         }
//       }
//       if (req.file) {
//         // ✅ If user already has an image, delete the old one first
//         if (user.profileImageURL) {
//           await deleteImageFromS3(user.profileImageURL);
//         }

//         // ✅ Upload new image
//         const profileImage = await uploadImageToS3(req.file);
//         user.profileImageURL = profileImage;
//       }
//     }

//     console.log(user.phonenumbers);

//     await user.save();

//     // === Response ===
//     if (updatedWhatsappTemplate || updatedEmailTemplate) {
//       const responseData = {
//         id: user._id,
//         firstname: user.firstname,
//         lastname: user.lastname,
//         email: user.email,
//         phonenumbers: user.phonenumbers,
//         qrcode: user.qrcode,
//         linkedin: user.linkedin,
//         instagram: user.instagram,
//         telegram: user.telegram,
//         twitter: user.twitter,
//         facebook: user.facebook,
//         designation: user.designation,
//         provider: user.provider,
//         profileImageURL: user.profileImageURL,
//         templates: {},
//       };

//       if (updatedWhatsappTemplate) {
//         responseData.templates.whatsappTemplates = {
//           whatsappTemplatesData: [updatedWhatsappTemplate],
//         };
//       }

//       if (updatedEmailTemplate) {
//         responseData.templates.emailTemplates = {
//           emailTemplatesData: [updatedEmailTemplate],
//         };
//       }

//       return res.status(200).json({
//         status: "success",
//         message: "Template added or updated successfully",
//         data: responseData,
//       });
//     } else {
//       return res.status(200).json({
//         status: "success",
//         message: "Profile updated successfully",
//         data: {
//           id: user._id,
//           firstname: user.firstname,
//           lastname: user.lastname,
//           email: user.email,
//           phonenumbers: user.phonenumbers,
//           profileImageURL: user.profileImageURL,
//           qrcode: user.qrcode,
//           linkedin: user.linkedin,
//           instagram: user.instagram,
//           telegram: user.telegram,
//           twitter: user.twitter,
//           facebook: user.facebook,
//           designation: user.designation,
//           provider: user.provider,
//           // whatsappTemplates: user.whatsappTemplates,
//           // emailTemplates: user.emailTemplates,
//         },
//       });
//     }
//   } catch (error) {
//     console.error("Edit Profile Error:", error);
//     return res.status(500).json({ status: "error", message: "Server error" });
//   }
// };


// module.exports = { editProfile };


const path = require("path");
const mongoose = require("mongoose");
const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const User = require("../models/userModel");
const s3 = require("../utils/s3");

// === Upload Image to S3 ===
const uploadImageToS3 = async (file) => {
  const ext = path.extname(file.originalname);
  const name = path.basename(file.originalname, ext);
  const fileName = `profileImages/${name}_${Date.now()}${ext}`;

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  const command = new PutObjectCommand(params);
  await s3.send(command);

  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
};

// === Delete Image from S3 ===
const deleteImageFromS3 = async (imageUrl) => {
  try {
    if (!imageUrl) return;

    const urlParts = imageUrl.split(".amazonaws.com/");
    if (urlParts.length < 2) return;

    const fileKey = urlParts[1];
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileKey,
    };

    const command = new DeleteObjectCommand(params);
    await s3.send(command);
    console.log(`✅ Deleted from S3: ${fileKey}`);
  } catch (err) {
    console.error("Failed to delete from S3:", err);
  }
};

// === Edit Profile ===
const editProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      firstName,
      lastName,
      email,
      linkedin,
      instagram,
      telegram,
      twitter,
      facebook,
      designation,
      phonenumbers = [],
    } = req.body;

    console.log("📱 Incoming phonenumbers:", firstName, lastName);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    const keys = Object.keys(req.body);

    if (keys.includes("firstName")) user.firstName = firstName;
    if (keys.includes("lastName")) user.lastName = lastName;
    if (keys.includes("linkedin")) user.linkedin = linkedin;
    if (keys.includes("instagram")) user.instagram = instagram;
    if (keys.includes("telegram")) user.telegram = telegram;
    if (keys.includes("twitter")) user.twitter = twitter;
    if (keys.includes("facebook")) user.facebook = facebook;
    if (keys.includes("designation")) user.designation = designation;

    // === Email Validation ===
    if (keys.includes("email") && email) {
      const trimmedEmail = email.trim().toLowerCase();

      if (["email", "google", "linkedin"].includes(user.signupMethod)) {
        if (trimmedEmail !== user.email) {
          return res.status(400).json({
            status: "error",
            message: "You cannot change email for this account.",
          });
        }
      } else {
        const existingUser = await User.findOne({
          email: trimmedEmail,
          _id: { $ne: user._id },
        });
        if (existingUser) {
          return res.status(400).json({
            status: "error",
            message: "This email is already used.",
          });
        }
        user.email = trimmedEmail;
      }
    }

    // === Phone Number Validation ===
    let parsedPhones = phonenumbers;

    // 🧠 Handle form-data case: parse stringified JSON
    if (typeof phonenumbers === "string") {
      try {
        parsedPhones = JSON.parse(phonenumbers);
      } catch (err) {
        console.warn("⚠️ Could not parse phonenumbers JSON:", err.message);
        parsedPhones = [];
      }
    }

    if (Array.isArray(parsedPhones) && parsedPhones.length > 0) {
      const normalizedPhones = parsedPhones.map((p) => ({
        countryCode: String(p.countryCode || "").replace(/\D/g, ""),
        number: String(p.number || "").replace(/\D/g, ""),
      }));

      // Prevent change if user signed up by phone
      if (user.signupMethod === "phoneNumber") {
        const currentPhones = user.phonenumbers || [];
        const sameNumbers =
          currentPhones.length === normalizedPhones.length &&
          currentPhones.every((cur, i) => {
            const newP = normalizedPhones[i];
            return cur.countryCode === newP.countryCode && cur.number === newP.number;
          });

        if (!sameNumbers) {
          return res.status(400).json({
            status: "error",
            message: "You cannot change phone number for this account.",
          });
        }
      } else {
        // Check duplicates
        for (const p of normalizedPhones) {
          const exists = await User.findOne({
            phonenumbers: { $elemMatch: p },
            _id: { $ne: user._id },
          });
          if (exists) {
            return res.status(400).json({
              status: "error",
              message: `Phone number +${p.countryCode}${p.number} is already used.`,
            });
          }
        }

        // ✅ Important: markModified ensures mongoose saves the array
        user.phonenumbers = normalizedPhones;
        user.markModified("phonenumbers");
      }
    }


    // === Profile Image Handling ===
    if (keys.includes("profileImage")) {
      if (!req.body.profileImage || req.body.profileImage.trim() === "") {
        await deleteImageFromS3(user.profileImageURL);
        user.profileImageURL = "";
      }
    }

    if (req.file) {
      if (user.profileImageURL) {
        await deleteImageFromS3(user.profileImageURL);
      }

      const profileImage = await uploadImageToS3(req.file);
      user.profileImageURL = profileImage;
    }

    await user.save();

    return res.status(200).json({
      status: "success",
      message: "Profile updated",
      data: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phonenumbers: user.phonenumbers,
        profileImageURL: user.profileImageURL,
        linkedin: user.linkedin,
        instagram: user.instagram,
        telegram: user.telegram,
        twitter: user.twitter,
        facebook: user.facebook,
        designation: user.designation,
        provider: user.provider,
      },
    });
  } catch (error) {
    console.error("Edit Profile Error:", error);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
};


module.exports = { editProfile };

