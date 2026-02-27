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


        // 🔐 Detailed Password Validation
        const passwordErrors = [];

        if (password.length < 8) {
            passwordErrors.push("Password must be at least 8 characters long.");
        }

        if (!/[A-Z]/.test(password)) {
            passwordErrors.push("Password must contain at least one uppercase letter.");
        }

        if (!/[a-z]/.test(password)) {
            passwordErrors.push("Password must contain at least one lowercase letter.");
        }

        if (!/[0-9]/.test(password)) {
            passwordErrors.push("Password must contain at least one number.");
        }

        if (!/[!@#$%^&*(),.?\":{}|<>_\-+=]/.test(password)) {
            passwordErrors.push("Password must contain at least one special character.");
        }

        if (passwordErrors.length > 0) {
            return res.status(400).json({
                status: "error",
                message: passwordErrors,
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

        // ✅ CREATE NEW SESSION (MULTI-SESSION SUPPORT)
        const newSessionId = crypto.randomBytes(32).toString("hex");
        const deviceId = req.body.deviceId || crypto.createHmac("sha256", "voycell-fingerprint").update((req.headers["user-agent"] || "") + (req.ip || "")).digest("hex");

        const sessionData = {
            sessionId: newSessionId,
            deviceId: deviceId,
            ip: req.ip,
            userAgent: req.headers["user-agent"],
            createdAt: new Date()
        };

        // If login from a DIFFERENT device, clear everything
        const otherDeviceSessions = user.activeSessions.filter(s => s.deviceId !== deviceId);
        if (otherDeviceSessions.length > 0) {
            user.activeSessions = [];
        }

        // Handle same-device sessions (limit to 2)
        const sameDeviceSessions = user.activeSessions.filter(s => s.deviceId === deviceId);
        if (sameDeviceSessions.length >= 2) {
            // Remove oldest session on this device
            const oldestOnDevice = sameDeviceSessions.sort((a, b) => a.createdAt - b.createdAt)[0];
            user.activeSessions = user.activeSessions.filter(s => s.sessionId !== oldestOnDevice.sessionId);
        }

        user.activeSessions.push(sessionData);
        user.activeSessionId = newSessionId; // Backward compatibility
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