const User = require("../models/userModel");
const { getValidToken } = require("../utils/yeastarClient");
const { createHmac, randomBytes } = require("crypto");
const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL; // e.g. https://cmedia.ras.yeastar.com/openapi/v1.0
const axios = require("axios");

const changePassword = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ message: "New password is required" });
    }

    const userId = req.user._id;
    const user = await User.findById(userId).select("+salt");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Generate new salt & hash
    const salt = randomBytes(16).toString();
    const hashedPassword = createHmac("sha256", salt)
      .update(newPassword)
      .digest("hex");

    // ✅ Update with hashed password
    await User.updateOne(
      { _id: userId },
      { $set: { password: hashedPassword, salt } }
    );

    return res.status(200).json({
      status: "success",
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ status: "error", message: "Internal server error" });
  }
};

// ✅ Password validation helper
function validateYeastarPassword(password) {
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpace = /\s/.test(password);
  const hasSpecial = /[@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?!]/.test(password);

  if (password.length < 6 || password.length > 32) {
    return "Password must be between 6 and 32 characters";
  }

  if (!hasUppercase) {
    return "Password must contain at least one uppercase letter";
  }

  if (!hasLowercase) {
    return "Password must contain at least one lowercase letter";
  }

  if (!hasNumber) {
    return "Password must contain at least one number";
  }

  if (!hasSpecial) {
    return "Password must contain at least one special character (@#$%^& etc)";
  }

  if (hasSpace) {
    return "Password must not contain spaces";
  }

  return null; // ✅ valid password
}

// ✅ FINAL API
const changeSipSecret = async (req, res) => {
  try {
    const userId = req.user._id;
    const { password } = req.body; // ✅ Password comes from user

    // ✅ 1. Validate request
    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required"
      });
    }

    const passwordError = validateYeastarPassword(password);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        message: passwordError
      });
    }

    // ✅ 2. Get user
    const user = await User.findById(userId);

    if (!user || !user.extensionNumber) {
      return res.status(404).json({
        success: false,
        message: "User or extension not found"
      });
    }

    // ✅ 3. Get Yeastar Token
    const token = await getValidToken();
    const url = `${YEASTAR_BASE_URL}/extension/update?access_token=${token}`;

    const body = {
      id: parseInt(user.yeastarExtensionId),
      reg_password: password,   // ✅ SIP device password
      user_password: password  // ✅ Yeastar web password
    };

    // ✅ 4. Update Yeastar
    const response = await axios.post(url, body);
    const data = response.data;

    if (data.errcode !== 0) {
      return res.status(400).json({
        success: false,
        message: "Failed to update SIP secret on Yeastar",
        yeastarError: data
      });
    }

    // ✅ 5. Update MongoDB
    user.sipSecret = password;
    await user.save();

    // ✅ 6. Success response
    return res.status(200).json({
      success: true,
      message: "SIP secret updated successfully",
      extensionNumber: user.extensionNumber
    });

  } catch (error) {
    console.error("❌ changeSipSecret error:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.response?.data || error.message
    });
  }
};

module.exports = { changePassword, changeSipSecret };
