const crypto = require("crypto");
const User = require("../../models/userModel");
const { sendVerificationEmail } = require("../../utils/emailUtils");
const { createYeastarExtensionForUser } = require("../../utils/yeastarClient");
const { createTokenforUser } = require("../../services/authentication");


/**
 * ======================================================
 * USER VERIFY & COMPLETE SIGNUP API
 * ======================================================
 * User verifies email and sets password
 */
exports.verifyUser = async (req, res) => {    
    try {
        const { verifyToken, password } = req.body;

        if (!verifyToken || !password) {
            return res.status(400).json({
                status: "error",
                message: "Verification token and password are required",
            });
        }

        const user = await User.findOne({ emailVerificationToken: verifyToken });
        if (!user) {
            return res.status(400).json({
                status: "error",
                message: "Invalid or expired verification token",
            });
        }

        user.isVerified = true;
        user.isActive = true;
        user.emailVerificationToken = undefined;
        user.password = password;

        await user.save();

        const token = createTokenforUser(user);

        return res.status(200).json({
            status: "success",
            message: "Account verified successfully",
            data: {
                token,
                registeredWith: user.signupMethod,
            },
        });
    } catch (error) {
        return res.status(500).json({
            status: "error",
            message: "Verification failed",
            error: error.message,
        });
    }
};