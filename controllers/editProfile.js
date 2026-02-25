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

    const bucket = process.env.AWS_BUCKET_NAME;
    let fileKey;

    // Try robust URL parsing first (handles virtual-hosted and path-style URLs)
    try {
      const parsed = new URL(imageUrl);
      // pathname might be "/profileImages/..." or "/<bucket>/profileImages/..."
      fileKey = parsed.pathname.startsWith("/") ? parsed.pathname.slice(1) : parsed.pathname;

      // If the pathname includes the bucket name at the front, remove it.
      if (fileKey.startsWith(`${bucket}/`)) {
        fileKey = fileKey.slice(bucket.length + 1);
      }
    } catch (err) {
      // Fallback for other URL formats (e.g. older code that used ".amazonaws.com/")
      const urlParts = imageUrl.split(".amazonaws.com/");
      if (urlParts.length >= 2) {
        fileKey = urlParts[1];
      } else {
        return;
      }
    }

    if (!fileKey) {
      return;
    }

    const params = {
      Bucket: bucket,
      Key: fileKey,
    };

    const command = new DeleteObjectCommand(params);
    await s3.send(command);
  } catch (err) {
    console.error("Failed to delete from S3:", err);
  }
};


// === Edit Profile ===
const editProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      firstname,
      lastname,
      email,
      linkedin,
      instagram,
      telegram,
      twitter,
      facebook,
      designation,
      telephone,
      phonenumbers = [],
      companyName,
    } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    const keys = Object.keys(req.body);

    if (keys.includes("firstname")) user.firstname = firstname;
    if (keys.includes("lastname")) user.lastname = lastname;
    if (keys.includes("linkedin")) user.linkedin = linkedin;
    if (keys.includes("instagram")) user.instagram = instagram;
    if (keys.includes("telegram")) user.telegram = telegram;
    if (keys.includes("twitter")) user.twitter = twitter;
    if (keys.includes("facebook")) user.facebook = facebook;
    if (keys.includes("designation")) user.designation = designation;
    if (keys.includes("telephone")) {
      // normalize: trim and remove extra spaces
      user.telephone =
        typeof telephone === "string" ? telephone.trim() : telephone;
    }

    // Update companyName for companyAdmin role
    if (user.role === "companyAdmin" && keys.includes("companyName")) {
      if (!user.userInfo) user.userInfo = {};
      user.userInfo.companyName = companyName || "";
      user.markModified("userInfo");
    }

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
            return (
              cur.countryCode === newP.countryCode && cur.number === newP.number
            );
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

    // === Profile Image Removal (Works for Postman + Frontend) ===
    const rawProfileImageField = req.body.profileImage;

    // ✅ Remove if explicitly sent as empty
    const shouldRemove =
      rawProfileImageField === "" ||
      rawProfileImageField === null ||
      rawProfileImageField === "null" ||
      rawProfileImageField === "undefined";

    // ✅ ALSO remove if frontend wants to remove but didn't send file
    if (shouldRemove && !req.file) {
      if (user.profileImageURL) {
        await deleteImageFromS3(user.profileImageURL);
        user.profileImageURL = "";
      }
    }


    if (req.file) {
      if (user.profileImageURL) {
        try {
          await deleteImageFromS3(user.profileImageURL);
        } catch (err) {
          console.warn("Failed to delete previous profile image before upload:", err);
        }
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
        firstname: user.firstname,
        lastname: user.lastname,
        email: user.email,
        phonenumbers: user.phonenumbers,
        telephone: user.telephone,
        profileImageURL: user.profileImageURL,
        linkedin: user.linkedin,
        instagram: user.instagram,
        telegram: user.telegram,
        twitter: user.twitter,
        facebook: user.facebook,
        designation: user.designation,
        provider: user.provider,
        userInfo: user.userInfo,
      },
    });
  } catch (error) {
    return res.status(500).json({ status: "error", message: "Server error" });
  }
};

// Update contact statuses
const updateLeadStatuses = async (req, res) => {
  try {
    const userId = req.user._id;
    const { contactStatuses, category } = req.body;

    // Determine which field to update based on category
    const fieldToUpdate =
      category === "lead" ? "leadStatuses" : "contactStatuses";
    const statusesData = contactStatuses; // Keep the same param name for backward compatibility

    // Validate that statuses is an array
    if (!Array.isArray(statusesData)) {
      return res.status(400).json({
        status: "error",
        message: `${fieldToUpdate} must be an array`,
      });
    }

    // Validate each status has value, label, and group
    for (const status of statusesData) {
      if (!status.value || !status.label || typeof status.group !== "number") {
        return res.status(400).json({
          status: "error",
          message: "Each status must have a value, label, and group number",
        });
      }
    }

    // Get current user's statuses to check what's being removed/modified
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    const currentStatuses =
      category === "lead"
        ? currentUser.leadStatuses
        : currentUser.contactStatuses;
    const newStatusValues = statusesData.map((s) => s.value);
    const removedStatuses = currentStatuses.filter(
      (cs) => !newStatusValues.includes(cs.value)
    );

    // Check if any removed statuses are currently in use
    if (removedStatuses.length > 0) {
      const Contact = require("../models/contactModel");
      const Lead = require("../models/leadModel");

      const removedStatusValues = removedStatuses.map((rs) => rs.value);
      const modelToCheck = category === "lead" ? Lead : Contact;

      const recordsUsingStatus = await modelToCheck
        .find({
          createdBy: userId,
          status: { $in: removedStatusValues },
        })
        .select("firstname lastname status");

      if (recordsUsingStatus.length > 0) {
        const statusInUse = [
          ...new Set(recordsUsingStatus.map((r) => r.status)),
        ];
        const recordNames = recordsUsingStatus
          .map((r) => `${r.firstname} ${r.lastname}`)
          .slice(0, 3);
        const moreCount =
          recordsUsingStatus.length > 3
            ? ` and ${recordsUsingStatus.length - 3} more`
            : "";

        return res.status(400).json({
          status: "error",
          message: `Cannot delete status(es) "${statusInUse.join(
            '", "'
          )}" as they are currently used by ${category === "lead" ? "leads" : "contacts"
            }: ${recordNames.join(
              ", "
            )}${moreCount}. Please change their status first.`,
        });
      }
    }

    // Update user's statuses (contact or lead based on category)
    const updateData = {};
    updateData[fieldToUpdate] = statusesData;

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    return res.status(200).json({
      status: "success",
      message: `${category === "lead" ? "Lead" : "Contact"
        } statuses updated successfully`,
      data: {
        contactStatuses: user.contactStatuses,
        leadStatuses: user.leadStatuses,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Server error",
    });
  }
};

// Update contact statuses
const updateContactStatuses = async (req, res) => {
  try {
    const userId = req.user._id;
    const { contactStatuses, category } = req.body;

    // Determine which field to update based on category
    const fieldToUpdate =
      category === "lead" ? "leadStatuses" : "contactStatuses";
    const statusesData = contactStatuses; // Keep the same param name for backward compatibility

    // Validate that statuses is an array
    if (!Array.isArray(statusesData)) {
      return res.status(400).json({
        status: "error",
        message: `${fieldToUpdate} must be an array`,
      });
    }

    // Validate each status has value and label
    for (const status of statusesData) {
      if (!status.value || !status.label) {
        return res.status(400).json({
          status: "error",
          message: "Each status must have a value and label",
        });
      }
    }

    // Get current user's statuses to check what's being removed/modified
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    const currentStatuses =
      category === "lead"
        ? currentUser.leadStatuses
        : currentUser.contactStatuses;
    const newStatusValues = statusesData.map((s) => s.value);
    const removedStatuses = currentStatuses.filter(
      (cs) => !newStatusValues.includes(cs.value)
    );

    // Check if any removed statuses are currently in use
    if (removedStatuses.length > 0) {
      const Contact = require("../models/contactModel");
      const Lead = require("../models/leadModel");

      const removedStatusValues = removedStatuses.map((rs) => rs.value);
      const modelToCheck = category === "lead" ? Lead : Contact;

      const recordsUsingStatus = await modelToCheck
        .find({
          createdBy: userId,
          status: { $in: removedStatusValues },
        })
        .select("firstname lastname status");

      if (recordsUsingStatus.length > 0) {
        const statusInUse = [
          ...new Set(recordsUsingStatus.map((r) => r.status)),
        ];
        const recordNames = recordsUsingStatus
          .map((r) => `${r.firstname} ${r.lastname}`)
          .slice(0, 3);
        const moreCount =
          recordsUsingStatus.length > 3
            ? ` and ${recordsUsingStatus.length - 3} more`
            : "";

        return res.status(400).json({
          status: "error",
          message: `Cannot delete status(es) "${statusInUse.join(
            '", "'
          )}" as they are currently used by ${category === "lead" ? "leads" : "contacts"
            }: ${recordNames.join(
              ", "
            )}${moreCount}. Please change their status first.`,
        });
      }
    }

    // Update user's statuses (contact or lead based on category)
    const updateData = {};
    updateData[fieldToUpdate] = statusesData;

    const user = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    return res.status(200).json({
      status: "success",
      message: `${category === "lead" ? "Lead" : "Contact"
        } statuses updated successfully`,
      data: {
        contactStatuses: user.contactStatuses,
        leadStatuses: user.leadStatuses,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Server error",
    });
  }
};

module.exports = { editProfile, updateContactStatuses, updateLeadStatuses };
