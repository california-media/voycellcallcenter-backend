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
    console.log("hello");
    
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

        // Create Yeastar Extension
        // try {
        //     const { extensionNumber, secret, result } =
        //         await createYeastarExtensionForUser(user);

        //     if (!extensionNumber || !result || result.errcode !== 0) {
        //         throw new Error(result?.errmsg || "Yeastar extension creation failed");
        //     }

        //     user.extensionNumber = extensionNumber;
        //     user.yeastarExtensionId = result?.data?.id || result?.id || null;
        //     user.sipSecret = secret;
        //     user.yeastarProvisionStatus = "done";
        // } catch (err) {
        //     console.error("Yeastar extension creation failed:", err.message);
        //     user.yeastarProvisionStatus = "failed";
        //     user.yeastarProvisionError = err.message;
        // }

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
        console.error("Verify User Error:", error);
        return res.status(500).json({
            status: "error",
            message: "Verification failed",
            error: error.message,
        });
    }
};