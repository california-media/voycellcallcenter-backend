// const jwt = require("jsonwebtoken");
const User = require("../../models/userModel");

// @desc    Get Admin Details
// @route   GET /api/admin/details
// @access  Private (Superadmin only)
exports.getAdminDetails = async (req, res) => {
    try {
        // token will already be verified in middleware
        const admin = await User.findById(req.user._id).select(
            "-password -salt -otp -otpExpiresAt -resetPasswordToken -resetPasswordExpires -__v"
        );

        if (!admin || admin.role !== "superadmin") {
            return res.status(403).json({ message: "Not authorized as admin" });
        }

        res.json({
            status: "success",
            message: "Admin details fetched successfully",
            data: admin,
        });
    } catch (err) {
        console.error("❌ Get Admin Details Error:", err);
        res.status(500).json({ status: "error", message: err.message });
    }
};
