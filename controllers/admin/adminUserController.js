const crypto = require("crypto");
const User = require("../../models/userModel");
const Lead = require("../../models/leadModel");
const mongoose = require("mongoose");
const Contact = require("../../models/contactModel");
const { sendVerificationEmail } = require("../../utils/emailUtils");
const {
  createYeastarExtensionForUser,
  deleteYeastarExtension,
} = require("../../utils/yeastarClient");
const { createTokenforUser } = require("../../services/authentication");

/**
 * ======================================================
 * ADMIN REGISTER USER API
 * ======================================================
 * Admin creates a user → sends verification email
 */

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const disallowedEmailDomains = [
  // "gmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "aol.com",
  "mail.com",
  "gmx.com",
  "protonmail.com",
  "zoho.com",
  "yandex.com",
  "tutanota.com",
  "fastmail.com",
  "hushmail.com",
  "inbox.com",
  "lycos.com",
];

exports.adminRegisterUser = async (req, res) => {
  try {
    const { email, firstname = "", lastname = "" } = req.body;

    if (!email) {
      return res.status(400).json({
        status: "error",
        message: "Email is required",
      });
    }

    // === BLOCK PUBLIC EMAIL PROVIDERS ===
    const emailDomain = email.split("@")[1]?.toLowerCase();
    if (!emailDomain) {
      return res.status(400).json({
        status: "error",
        message: "Invalid email format",
      });
    }

    if (disallowedEmailDomains.includes(emailDomain)) {
      return res.status(400).json({
        status: "error",
        message: `Registration using ${emailDomain} is not allowed. Please use your company or custom domain email.`,
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        status: "error",
        message: "User with this email already exists",
      });
    }

    const emailVerificationToken = crypto.randomBytes(32).toString("hex");
    const createdByWhichCompanyAdmin = req.user._id;

    const newUser = await User.create({
      email,
      firstname,
      lastname,
      isVerified: false,
      signupMethod: "email",
      role: "user",
      emailVerificationToken,
      isActive: false,
      createdByWhichCompanyAdmin,
    });

    const verificationLink =
      FRONTEND_URL + `/agent-setup?verificationToken=${emailVerificationToken}`;

    await sendVerificationEmail(email, verificationLink);

    return res.status(201).json({
      status: "success",
      message: "User created successfully. Verification email sent.",
      data: {
        _id: newUser._id,
        email: newUser.email,
        verificationLink,
      },
    });
  } catch (error) {
    await User.deleteOne({ email: req.body.email });
    return res.status(500).json({
      status: "error",
      message: "User creation failed",
      error: error.message,
    });
  }
};

exports.getAllUsersByCompanyAdmin = async (req, res) => {
  try {
    // ✅ IMPORTANT: Cast to ObjectId
    const companyAdminId = new mongoose.Types.ObjectId(req.user._id);

    const users = await User.aggregate([
      // 1️⃣ Match agents
      {
        $match: {
          createdByWhichCompanyAdmin: companyAdminId,
          role: "user",
        },
      },

      // 2️⃣ Lookup contacts
      {
        $lookup: {
          from: "contacts",
          localField: "_id",
          foreignField: "createdBy",
          as: "contacts",
        },
      },

      // 3️⃣ Lookup leads
      {
        $lookup: {
          from: "leads",
          localField: "_id",
          foreignField: "createdBy",
          as: "leads",
        },
      },

      // 4️⃣ Add counts
      {
        $addFields: {
          contactCount: { $size: "$contacts" },
          leadCount: { $size: "$leads" },
        },
      },

      // 5️⃣ Remove sensitive + heavy fields
      {
        $project: {
          password: 0,
          salt: 0,
          otp: 0,
          otpExpiresAt: 0,
          resetPasswordToken: 0,
          resetPasswordExpires: 0,
          contacts: 0,
          leads: 0,
        },
      },

      // 6️⃣ Sort
      {
        $sort: { createdAt: -1 },
      },
    ]);

    return res.status(200).json({
      status: "success",
      message: "Agents fetched successfully",
      count: users.length,
      data: users,
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
 * ======================================================
 * EDIT AGENT (UPDATE USER) API
 * ======================================================
 * Update agent's basic information (firstname, lastname, email)
 */
exports.editAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstname, lastname, email, isWaba = false } = req.body;
    const companyAdminId = req.user._id;

    // Find the user and verify ownership
    const user = await User.findOne({
      _id: id,
      createdByWhichCompanyAdmin: companyAdminId,
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message:
          "Agent not found or you don't have permission to edit this agent",
      });
    }

    // Get company admin (needed for WABA assignment)
    const companyAdmin = await User.findOne({
      _id: companyAdminId,
      role: "companyAdmin",
    });

    // If email is being changed, check if new email already exists
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(409).json({
          status: "error",
          message: "Email already exists",
        });
      }

      // Validate email domain if changing email
      const emailDomain = email.split("@")[1]?.toLowerCase();
      if (!emailDomain) {
        return res.status(400).json({
          status: "error",
          message: "Invalid email format",
        });
      }

      if (disallowedEmailDomains.includes(emailDomain)) {
        return res.status(400).json({
          status: "error",
          message: `Email domain ${emailDomain} is not allowed. Please use your company or custom domain email.`,
        });
      }

      user.email = email;
    }

    // Update other fields
    if (firstname !== undefined) user.firstname = firstname;
    if (lastname !== undefined) user.lastname = lastname;

    /* ================================
   WABA Assign / Unassign Logic
=================================*/

    if (typeof isWaba === "boolean") {

      // ASSIGN WABA
      if (isWaba === true) {

        if (!companyAdmin?.whatsappWaba?.isConnected) {
          return res.status(400).json({
            status: "error",
            message: "Company admin has no connected WABA",
          });
        }

        user.whatsappWaba = {
          ...companyAdmin.whatsappWaba.toObject(),
          chats: [],
          isConnected: true,
        };
      }

      // UNASSIGN WABA
      else {
        user.whatsappWaba = {
          isConnected: false,
          wabaId: null,
          phoneNumberId: null,
          businessAccountId: null,
          accessToken: null,
          tokenExpiresAt: null,
          phoneNumber: null,
          displayName: null,
          qualityRating: null,
          messagingLimit: null,
          businessVerificationStatus: null,
          accountReviewStatus: null,
          status: null,
          profile: {},
          webhook: {},
          chats: [],
        };
      }
    }

    await user.save();

    return res.status(200).json({
      status: "success",
      message: "Agent updated successfully",
      data: {
        _id: user._id,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Failed to update agent",
      error: error.message,
    });
  }
};
/**
 * ======================================================
 * DELETE AGENT API
 * ======================================================
 * Delete agent and their Yeastar extension
 */
exports.deleteAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const companyAdminId = req.user._id;

    // Find the user and verify ownership
    const user = await User.findOne({
      _id: id,
      createdByWhichCompanyAdmin: companyAdminId,
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message:
          "Agent not found or you don't have permission to delete this agent",
      });
    }

    // Delete Yeastar extension if it exists
    if (user.yeastarExtensionId) {
      try {
        await deleteYeastarExtension(user.yeastarExtensionId);
      } catch (err) {
        // Continue with user deletion even if Yeastar deletion fails
      }
    }

    // Delete the user from database
    await User.findByIdAndDelete(id);

    return res.status(200).json({
      status: "success",
      message: "Agent deleted successfully",
      data: {
        _id: user._id,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Failed to delete agent",
      error: error.message,
    });
  }
};
