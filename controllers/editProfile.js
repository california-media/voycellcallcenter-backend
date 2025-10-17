const path = require("path");
const mongoose = require("mongoose");
const { PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const User = require("../models/userModel");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const s3 = require("../utils/s3");

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

const deleteImageFromS3 = async (imageUrl) => {
  try {
    if (!imageUrl) return;

    // Extract the Key from the URL
    const urlParts = imageUrl.split(".amazonaws.com/");
    if (urlParts.length < 2) return; // not a valid S3 URL

    const fileKey = urlParts[1]; // profileImages/filename.jpg

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

const editProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      firstname,
      lastname,
      email,
      // phonenumber,
      // countryCode,
      linkedin,
      instagram,
      telegram,
      twitter,
      facebook,
      designation,
      whatsappTemplate_id,
      whatsappTemplateTitle,
      whatsappTemplateMessage,
      whatsappTemplateIsFavourite,
      emailTemplate_id,
      emailTemplateTitle,
      emailTemplateSubject,
      emailTemplateBody,
      emailTemplateIsFavourite,
      apiType = "web", // default to web if not provided
    } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    let updatedWhatsappTemplate;
    let updatedEmailTemplate;

    // === WhatsApp Template Edit ===
    if (whatsappTemplate_id) {
      const index = user.whatsappTemplates.findIndex(
        (tpl) =>
          tpl.whatsappTemplate_id?.toString() === whatsappTemplate_id.toString()
      );

      if (index !== -1) {
        if (whatsappTemplateTitle)
          user.whatsappTemplates[index].whatsappTemplateTitle =
            whatsappTemplateTitle;
        if (whatsappTemplateMessage)
          user.whatsappTemplates[index].whatsappTemplateMessage =
            whatsappTemplateMessage;
        if (typeof whatsappTemplateIsFavourite !== "undefined") {
          user.whatsappTemplates[index].whatsappTemplateIsFavourite =
            whatsappTemplateIsFavourite;
        }
        updatedWhatsappTemplate = user.whatsappTemplates[index];
      } else {
        return res
          .status(404)
          .json({ status: "error", message: "WhatsApp template not found" });
      }
    }

    // === WhatsApp Template Add ===
    if (
      !whatsappTemplate_id &&
      whatsappTemplateTitle &&
      whatsappTemplateMessage
    ) {
      const newWhatsappTemplate = {
        whatsappTemplate_id: new mongoose.Types.ObjectId(),
        whatsappTemplateTitle,
        whatsappTemplateMessage,
        whatsappTemplateIsFavourite: !!whatsappTemplateIsFavourite,
      };
      user.whatsappTemplates.unshift(newWhatsappTemplate);
      updatedWhatsappTemplate = newWhatsappTemplate;
    }

    // === Email Template Edit ===
    if (emailTemplate_id) {
      const index = user.emailTemplates.findIndex(
        (tpl) =>
          tpl.emailTemplate_id?.toString() === emailTemplate_id.toString()
      );

      if (index !== -1) {
        if (emailTemplateTitle)
          user.emailTemplates[index].emailTemplateTitle = emailTemplateTitle;
        if (emailTemplateSubject)
          user.emailTemplates[index].emailTemplateSubject =
            emailTemplateSubject;
        if (emailTemplateBody)
          user.emailTemplates[index].emailTemplateBody = emailTemplateBody;
        if (typeof emailTemplateIsFavourite !== "undefined") {
          user.emailTemplates[index].emailTemplateIsFavourite =
            emailTemplateIsFavourite;
        }
        updatedEmailTemplate = user.emailTemplates[index];
      } else {
        return res
          .status(404)
          .json({ status: "error", message: "Email template not found" });
      }
    }

    // === Email Template Add ===
    if (
      !emailTemplate_id &&
      emailTemplateTitle &&
      emailTemplateSubject &&
      emailTemplateBody
    ) {
      const newEmailTemplate = {
        emailTemplate_id: new mongoose.Types.ObjectId(),
        emailTemplateTitle,
        emailTemplateSubject,
        emailTemplateBody,
        emailTemplateIsFavourite: !!emailTemplateIsFavourite,
      };
      user.emailTemplates.unshift(newEmailTemplate);
      updatedEmailTemplate = newEmailTemplate;
    }

    // === Update Basic Info ===
    if (
      !whatsappTemplate_id &&
      !emailTemplate_id &&
      !whatsappTemplateTitle &&
      !emailTemplateTitle
    ) {
      const keys = Object.keys(req.body);

      if (keys.includes("firstname")) user.firstname = firstname;
      if (keys.includes("lastname")) user.lastname = lastname;
      // if (keys.includes('email')) user.email = email;
      if (keys.includes("linkedin")) user.linkedin = linkedin;
      if (keys.includes("instagram")) user.instagram = instagram;
      if (keys.includes("telegram")) user.telegram = telegram;
      if (keys.includes("twitter")) user.twitter = twitter;
      if (keys.includes("facebook")) user.facebook = facebook;
      if (keys.includes("designation")) user.designation = designation;

      // if (keys.includes('email') && email) {
      //   const trimmedEmail = email.trim().toLowerCase();

      //   // Case 1: signupMethod = email|google|linkedin → disallow
      //   if (["email", "google", "linkedin"].includes(user.signupMethod)) {
      //     return res.status(400).json({
      //       status: "error",
      //       message: "You cannot change email for this account."
      //     });
      //   }

      //   // Case 2: signupMethod != email|google|linkedin (ex: phoneNumber) → check for duplicates
      //   const existingUser = await User.findOne({ email: trimmedEmail, _id: { $ne: user._id } });
      //   if (existingUser) {
      //     return res.status(400).json({
      //       status: "error",
      //       message: "This email is already used."
      //     });
      //   }

      //   user.email = trimmedEmail;
      // }

      if (keys.includes("email") && email) {
        const trimmedEmail = email.trim().toLowerCase();

        if (["email", "google", "linkedin"].includes(user.signupMethod)) {
          // ✅ If same email, allow silently
          if (trimmedEmail === user.email) {
            // no change, continue
          } else {
            return res.status(400).json({
              status: "error",
              message: "You cannot change email for this account.",
            });
          }
        } else {
          // Only check duplicates if signupMethod != email|google|linkedin
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

      // =========================
      // 🔒 PHONE UPDATE CHECKS
      // =========================
      // if (apiType === "mobile") {
      //   if (req.body.countryCode && req.body.phonenumber) {
      //     if (user.signupMethod === "phoneNumber") {
      //       return res.status(400).json({
      //         status: "error",
      //         message: "You cannot change phone number for this account."
      //       });
      //     }

      //     const newNumberObj = {
      //       countryCode: String(req.body.countryCode).replace(/\D/g, ""),
      //       number: String(req.body.phonenumber).replace(/\D/g, "")
      //     };

      //     // Check if this phone already exists
      //     const existingPhoneUser = await User.findOne({
      //       phonenumbers: { $elemMatch: newNumberObj },
      //       _id: { $ne: user._id }
      //     });

      //     if (existingPhoneUser) {
      //       return res.status(400).json({
      //         status: "error",
      //         message: "This phone number is already used."
      //       });
      //     }

      //     user.phonenumbers = [newNumberObj];
      //   }
      // }
      if (apiType === "mobile") {
        if (req.body.countryCode && req.body.phonenumber) {
          const newNumberObj = {
            countryCode: String(req.body.countryCode).replace(/\D/g, ""),
            number: String(req.body.phonenumber).replace(/\D/g, ""),
          };

          if (user.signupMethod === "phoneNumber") {
            // ✅ If same number, allow silently
            const currentPhone = user.phonenumbers?.[0];
            if (
              currentPhone &&
              currentPhone.countryCode === newNumberObj.countryCode &&
              currentPhone.number === newNumberObj.number
            ) {
              // same number, continue
            } else {
              return res.status(400).json({
                status: "error",
                message: "You cannot change phone number for this account.",
              });
            }
          } else {
            // check duplicates for other signup methods
            const existingPhoneUser = await User.findOne({
              phonenumbers: { $elemMatch: newNumberObj },
              _id: { $ne: user._id },
            });

            if (existingPhoneUser) {
              return res.status(400).json({
                status: "error",
                message: "This phone number is already used.",
              });
            }

            user.phonenumbers = [newNumberObj];
          }
        }
      } else if (apiType === "web") {
        if (req.body.phonenumber) {
          let rawNumber = req.body.phonenumber.trim();
          if (!rawNumber.startsWith("+")) rawNumber = "+" + rawNumber;

          const phoneObj = parsePhoneNumberFromString(rawNumber);
          if (!phoneObj || !phoneObj.isValid()) {
            return res.status(400).json({
              status: "error",
              message: "Invalid phone number format",
            });
          }

          const newNumberObj = {
            countryCode: phoneObj.countryCallingCode,
            number: phoneObj.nationalNumber,
          };

          if (user.signupMethod === "phoneNumber") {
            // ✅ If same number, allow silently

            const currentPhone = user.phonenumbers?.[0];
            if (
              currentPhone &&
              currentPhone.countryCode === newNumberObj.countryCode &&
              currentPhone.number === newNumberObj.number
            ) {
              // same number, continue
            } else {
              return res.status(400).json({
                status: "error",
                message: "You cannot change phone number for this account.",
              });
            }
          } else {
            // ✅ Duplicate check for other signup methods
            const existingPhoneUser = await User.findOne({
              phonenumbers: { $elemMatch: newNumberObj },
              _id: { $ne: user._id },
            });

            if (existingPhoneUser) {
              return res.status(400).json({
                status: "error",
                message: "This phone number is already used.",
              });
            }

            user.phonenumbers = [newNumberObj];
          }
        }
      }
      // }
      // else if (apiType === "web") {
      //   if (req.body.phonenumber) {
      //     if (user.signupMethod === "phoneNumber") {
      //       return res.status(400).json({
      //         status: "error",
      //         message: "You cannot change phone number for this account."
      //       });
      //     }

      //     let rawNumber = req.body.phonenumber.trim();
      //     if (!rawNumber.startsWith("+")) rawNumber = "+" + rawNumber;

      //     const phoneObj = parsePhoneNumberFromString(rawNumber);
      //     if (!phoneObj || !phoneObj.isValid()) {
      //       return res.status(400).json({ status: "error", message: "Invalid phone number format" });
      //     }

      //     const newNumberObj = {
      //       countryCode: phoneObj.countryCallingCode,
      //       number: phoneObj.nationalNumber
      //     };

      //     // Check if already exists
      //     const existingPhoneUser = await User.findOne({
      //       phonenumbers: { $elemMatch: newNumberObj },
      //       _id: { $ne: user._id }
      //     });

      //     if (existingPhoneUser) {
      //       return res.status(400).json({
      //         status: "error",
      //         message: "This phone number is already used."
      //       });
      //     }

      //     user.phonenumbers = [newNumberObj];
      //   }
      // }

      // if (keys.includes('phonenumbers')) {
      //   let parsedPhones;

      //   try {
      //     // If it's a stringified array, parse it
      //     parsedPhones = JSON.parse(phonenumbers);

      //     // If JSON-parsed value is a single number (not array), wrap in array
      //     if (!Array.isArray(parsedPhones)) {
      //       parsedPhones = [parsedPhones];
      //     }
      //   } catch {
      //     // If not JSON (plain string like '8546892104'), wrap in array
      //     parsedPhones = [phonenumbers];
      //   }

      //   // ✅ Normalize: remove '+' and non-digit characters (optional)
      //   user.phonenumbers = parsedPhones.map(num => {
      //     if (typeof num === 'string') {
      //       return num.replace(/[^\d]/g, ""); // remove +, spaces, etc.
      //     }
      //     return String(num);
      //   });
      // }

      // if (keys.includes('phonenumbers')) {
      //   let parsedPhones;

      //   try {
      //     parsedPhones = JSON.parse(phonenumbers);
      //     if (!Array.isArray(parsedPhones)) parsedPhones = [parsedPhones];
      //   } catch {
      //     parsedPhones = [phonenumbers];
      //   }

      //   user.phonenumbers = parsedPhones
      //     .map(num => typeof num === 'string' ? num.replace(/[^\d]/g, "") : String(num))
      //     .filter(num => num !== ""); // ✅ Remove empty strings
      // }

      // ✅ Add phone update here
      // if (req.body.countryCode && req.body.phonenumber) {
      //   user.phonenumbers = [
      //     {
      //       countryCode: String(req.body.countryCode).replace(/\D/g, ""), // keep only digits
      //       number: String(req.body.phonenumber).replace(/\D/g, "")       // keep only digits
      //     }
      //   ];
      // }

      // === Phone Numbers ===
      // if (apiType === "mobile") {
      //   // 📱 Case 1: Mobile - user gives separate countryCode & phonenumber
      //   if (req.body.countryCode && req.body.phonenumber) {
      //     user.phonenumbers = [
      //       {
      //         countryCode: String(req.body.countryCode).replace(/\D/g, ""),
      //         number: String(req.body.phonenumber).replace(/\D/g, "")
      //       }
      //     ];
      //   }
      // } else if (apiType === "web") {
      //   // 💻 Case 2: Web - user gives full number (with or without '+')
      //   if (req.body.phonenumber) {
      //     let rawNumber = req.body.phonenumber.trim();

      //     // Ensure number starts with '+'
      //     if (!rawNumber.startsWith("+")) {
      //       rawNumber = "+" + rawNumber;
      //     }

      //     const phoneObj = parsePhoneNumberFromString(rawNumber);

      //     if (phoneObj && phoneObj.isValid()) {
      //       user.phonenumbers = [
      //         {
      //           countryCode: phoneObj.countryCallingCode,  // e.g. "91"
      //           number: phoneObj.nationalNumber            // e.g. "7046658651"
      //         }
      //       ];
      //     } else {
      //       return res.status(400).json({
      //         status: "error",
      //         message: "Invalid phone number format"
      //       });
      //     }
      //   }
      // }

      //       if (keys.includes("email")) {
      //         const trimmedEmail = email?.trim()?.toLowerCase();
      //         const requestedMethod = req.body.signupMethod?.toLowerCase(); // coming from client
      //         const currentMethod = user.signupMethod;

      //         // === Case 1: Switching from Google OR PhoneNumber to Email login ===
      //         if ((currentMethod === "google" || currentMethod === "phoneNumber") && requestedMethod === "email") {
      //           if (!req.body.password) {
      //             return res.status(400).json({
      //               status: "error",
      //               message: "Please provide a password to switch to email login.",
      //             });
      //           }

      //           if (!trimmedEmail) {
      //             return res.status(400).json({
      //               status: "error",
      //               message: "Please provide a valid email to switch login method.",
      //             });
      //           }

      //           // Hash password using crypto
      //           const salt = crypto.randomBytes(16).toString("hex");
      //           const hashedPassword = crypto
      //             .createHmac("sha256", salt)
      //             .update(req.body.password)
      //             .digest("hex");

      //           // Save email, hashed password, and switch login method
      //           user.email = trimmedEmail;
      //           user.password = hashedPassword;
      //           user.salt = salt;
      //           user.signupMethod = "email";
      //           user.provider = "local"; // still local, not google/apple
      //           user.isVerified = false;

      //           // Generate verification token
      //           const token = crypto.randomBytes(32).toString("hex");
      //           user.emailVerificationToken = token;

      //           const verificationLink = `https://contacts-user-web.vercel.app/user-verification?verificationToken=${token}`;
      // console.log(verificationLink);

      //           await sendVerificationEmail(trimmedEmail, verificationLink);

      //           await user.save();

      //           return res.status(200).json({
      //             status: "pending_verification",
      //             message: "Verification email sent. Please verify to activate email login.",
      //           });
      //         }

      //         // === Case 2: Verifying email using token ===
      //         if (req.body.verifyToken) {
      //           const userToVerify = await User.findOne({
      //             email: trimmedEmail,
      //             emailVerificationToken: req.body.verifyToken,
      //           });

      //           if (!userToVerify) {
      //             return res.status(400).json({
      //               status: "error",
      //               message: "Invalid or expired verification token.",
      //             });
      //           }

      //           userToVerify.isVerified = true;
      //           userToVerify.signupMethod = "email";
      //           userToVerify.provider = "local";
      //           userToVerify.emailVerificationToken = undefined;

      //           await userToVerify.save();

      //           return res.status(200).json({
      //             status: "success",
      //             message: "Email verified successfully. You can now log in using email and password.",
      //           });
      //         }

      //         // === Case 3: Normal email update (for existing email-based users) ===
      //         if (currentMethod === "email") {
      //           user.email = trimmedEmail;
      //         } else {
      //           // If Google or PhoneNumber user tries to update email without switch
      //           if (trimmedEmail !== user.email) {
      //             return res.status(400).json({
      //               status: "error",
      //               message: "Email change not allowed unless explicitly switching to email login.",
      //             });
      //           }
      //         }
      //       }

      // if (req.file) {
      //   const profileImage = await uploadImageToS3(req.file);
      //   user.profileImageURL = profileImage;
      // }
      if (keys.includes("profileImage")) {
        // If client sends blank, remove the image
        if (!req.body.profileImage || req.body.profileImage.trim() === "") {
          await deleteImageFromS3(user.profileImageURL);
          user.profileImageURL = "";
        }
      }

      // if (req.file) {
      //   const profileImage = await uploadImageToS3(req.file);
      //   user.profileImageURL = profileImage;
      // }
      if (req.file) {
        // ✅ If user already has an image, delete the old one first
        if (user.profileImageURL) {
          await deleteImageFromS3(user.profileImageURL);
        }

        // ✅ Upload new image
        const profileImage = await uploadImageToS3(req.file);
        user.profileImageURL = profileImage;
      }
    }

    // const { qrCode } = await generateUserQRCode(user.firstname || "user", user.serialNumber, {
    //   firstname: user.firstname,
    //   lastname: user.lastname,
    //   phonenumbers: user.phonenumbers,
    //   email: user.emailaddresses,
    //   provider: "local"
    // });

    // user.qrcode = qrCode;
    console.log(user.phonenumbers);

    await user.save();

    // === Response ===
    if (updatedWhatsappTemplate || updatedEmailTemplate) {
      const responseData = {
        id: user._id,
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        phonenumbers: user.phonenumbers,
        qrcode: user.qrcode,
        linkedin: user.linkedin,
        instagram: user.instagram,
        telegram: user.telegram,
        twitter: user.twitter,
        facebook: user.facebook,
        designation: user.designation,
        provider: user.provider,
        profileImageURL: user.profileImageURL,
        templates: {},
      };

      if (updatedWhatsappTemplate) {
        responseData.templates.whatsappTemplates = {
          whatsappTemplatesData: [updatedWhatsappTemplate],
        };
      }

      if (updatedEmailTemplate) {
        responseData.templates.emailTemplates = {
          emailTemplatesData: [updatedEmailTemplate],
        };
      }

      return res.status(200).json({
        status: "success",
        message: "Template added or updated successfully",
        data: responseData,
      });
    } else {
      return res.status(200).json({
        status: "success",
        message: "Profile updated successfully",
        data: {
          id: user._id,
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          phonenumbers: user.phonenumbers,
          profileImageURL: user.profileImageURL,
          qrcode: user.qrcode,
          linkedin: user.linkedin,
          instagram: user.instagram,
          telegram: user.telegram,
          twitter: user.twitter,
          facebook: user.facebook,
          designation: user.designation,
          provider: user.provider,
          // whatsappTemplates: user.whatsappTemplates,
          // emailTemplates: user.emailTemplates,
        },
      });
    }
  } catch (error) {
    console.error("Edit Profile Error:", error);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
};

// const testingOneSignal = async (req, res) => {
//   try {
//     const ext_id = "68e5617c3b5414a7c66fdd75";
//     const data = await sendPushNotificationToUser(ext_id, {
//       heading: "Meeting Scheduled",
//       content: "Meeting Scheduled",
//       data: {
//         type: "meeting_created",
//       },
//     });
//     console.log("Test notification sent", data);
//     res.json({ message: "Test notification sent" });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Internal server error" });
//   }
// };

module.exports = { editProfile };
