const User = require("../models/userModel");
const { createHmac, randomBytes } = require("crypto");

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

module.exports = { changePassword };
