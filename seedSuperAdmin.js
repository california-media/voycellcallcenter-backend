const mongoose = require("mongoose");
const User = require("./models/userModel");
const bcrypt = require("bcrypt");
// const { generateUserQRCode } = require("./utils/qrUtils");
require("dotenv").config(); // If you're using .env config
mongoose.connect(process.env.MONGO_URL);

const createSuperAdmin = async () => {
    try {
        const existing = await User.findOne({ email: "superadmin@example.com" });
        if (existing) {
            console.log("Super admin already exists.");
            process.exit(0);
        }

        // const serialNumber = await User.getNextSerialNumber(); // ✅ Required
        // const hashedPassword = await bcrypt.hash("SuperSecure123", 10);

        const now = new Date();
        // const trialEnds = new Date(now);
        // trialEnds.setDate(trialEnds.getDate() + 14);

        // const { qrCode } = await generateUserQRCode( "user", serialNumber, {
        //     firstname: "super",
        //     lastname: "admin",
        //     email: "superadmin@example.com",
        //     provider: "local"
        // });
        const newUser = await User.create({
            email: "superadmin@example.com",
            password: "SuperSecure123",
            firstname: "Super",
            lastname: "Admin",
            // serialNumber,
            isVerified: true,
            signupMethod: "email",
            role: "superadmin", // ✅ Super Admin role
            // trialStart: now,
            // trialEnd: trialEnds,
            referralCode: "SUPERADMIN123",
            // qrCode: qrCode
        });

        console.log("✅ Super admin created:", newUser.email);
        process.exit(0);
    } catch (err) {
        console.error("❌ Error creating super admin:", err);
        process.exit(1);
    }
};

createSuperAdmin();
