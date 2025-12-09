const crypto = require("crypto");
const User = require("../../models/userModel");
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

    console.log(verificationLink);

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
    console.error(
      "Admin Register Error, deleting user with email: ",
      req.body.email,
      error
    );

    await User.deleteOne({ email: req.body.email });
    return res.status(500).json({
      status: "error",
      message: "User creation failed",
      error: error.message,
    });
  }
};

///get all agents(role = user) created by company admin
exports.getAllUsersByCompanyAdmin = async (req, res) => {
  try {
    const companyAdminId = req.user._id; // ✅ from auth middleware

    const users = await User.find({
      createdByWhichCompanyAdmin: companyAdminId,
    })
      .select(
        "-password -salt -otp -otpExpiresAt -resetPasswordToken -resetPasswordExpires"
      ) // hide sensitive data
      .sort({ createdAt: -1 });

    return res.status(200).json({
      message: "Agents fetched successfully",
      status: "success",
      count: users.length,
      data: users,
    });
  } catch (error) {
    console.error("❌ getAllUsersByCompanyAdmin error:", error);
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
    const { firstname, lastname, email } = req.body;
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
    console.error("❌ editAgent error:", error);
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
        console.log("✅ Yeastar extension deleted for user:", user.email);
      } catch (err) {
        console.error("⚠️ Failed to delete Yeastar extension:", err.message);
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
    console.error("❌ deleteAgent error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to delete agent",
      error: error.message,
    });
  }
};
