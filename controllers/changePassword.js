const User = require("../models/userModel");
const { createHmac, randomBytes } = require("crypto");
const axios = require("axios");
// const { getConfig } = require("../utils/getConfig");

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

    // 🔐 Detailed Password Validation
    const passwordErrors = [];

    if (newPassword.length < 8) {
      passwordErrors.push("Password must be at least 8 characters long.");
    }

    if (!/[A-Z]/.test(newPassword)) {
      passwordErrors.push(
        "Password must contain at least one uppercase letter.",
      );
    }

    if (!/[a-z]/.test(newPassword)) {
      passwordErrors.push(
        "Password must contain at least one lowercase letter.",
      );
    }

    if (!/[0-9]/.test(newPassword)) {
      passwordErrors.push("Password must contain at least one number.");
    }

    if (!/[!@#$%^&*(),.?\":{}|<>_\-+=]/.test(newPassword)) {
      passwordErrors.push(
        "Password must contain at least one special character.",
      );
    }

    if (passwordErrors.length > 0) {
      return res.status(400).json({
        status: "error",
        message: passwordErrors,
      });
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

module.exports = { changePassword };
