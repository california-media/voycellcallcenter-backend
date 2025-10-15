const User = require("../../models/userModel"); // adjust path if needed
const jwt = require("jsonwebtoken");

const superadminLogin = async (req, res) => {
    const { email = "", password = "" } = req.body;

    if (!email || !password) {
        return res.status(400).json({ status: "error", message: "Email and password are required" });
    }

    try {
        const trimmedEmail = email.trim().toLowerCase();

        const user = await User.findOne({ email: trimmedEmail });

        if (!user) {
            return res.status(401).json({ status: "error", message: "User not found" });
        }

        // Ensure user is superadmin
        if (user.role !== "superadmin") {
            return res.status(403).json({ status: "error", message: "Access denied. Superadmin only." });
        }

        // Check verification
        if (!user.isVerified) {
            return res.status(403).json({ status: "error", message: "Please verify your email before logging in" });
        }

        // Restrict if user registered via social login
        if (user.signupMethod === "google") {
            return res.status(400).json({ status: "error", message: "This user signed up with Google. Use Google login." });
        }
        if (user.signupMethod === "apple") {
            return res.status(400).json({ status: "error", message: "This user signed up with Apple. Use Apple login." });
        }
        if (user.signupMethod === "phoneNumber") {
            return res.status(400).json({ status: "error", message: "This user signed up with phone number. Use phone login." });
        }

        // Match password and generate token
        const token = await User.matchPasswordAndGenerateToken({
            email: trimmedEmail,
            password,
        });

        return res.json({
            status: "success",
            message: "Superadmin login successful",
            data: {
                token
            },
        });

    } catch (err) {
        console.error("Superadmin login failed:", err);
        return res.status(500).json({ status: "error", message: err.message || "Login failed" });
    }
};

module.exports = { superadminLogin };