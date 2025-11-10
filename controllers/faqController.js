const FAQ = require("../models/faqModel");
const User = require("../models/userModel");


// ✅ Add FAQ (company_admin only)
exports.addFAQ = async (req, res) => {
    try {
        const { question, answer } = req.body;

        if (!question || !answer) {
            return res.status(400).json({ message: "Question and answer are required" });
        }

        const faq = await FAQ.create({
            question,
            answer,
            createdBy: req.user._id, // assuming JWT middleware sets req.user
        });

        res.status(201).json({
            status: "success",
            message: "FAQ Added",
            data: faq,
        });
    } catch (error) {
        console.error("Error adding FAQ:", error);
        res.status(500).json({ status: "error", message: "Server error", error: error.message });
    }
};

// 🧩 GET FAQs (role-based using token only)
exports.getFAQs = async (req, res) => {
    try {
        // 1️⃣ Get logged-in user (decoded via middleware)
        const loggedInUserId = req.user._id;

        // 2️⃣ Find full user info from DB
        const user = await User.findById(loggedInUserId);

        if (!user) {
            return res.status(404).json({
                status: "error",
                message: "User not found",
            });
        }

        let faqs = [];

        // 3️⃣ Role-based logic
        if (user.role === "superadmin") {
            // Super admin gets all FAQs
            faqs = await FAQ.find().sort({ createdAt: -1 });
        } else if (user.role === "companyAdmin") {
            // Company admin gets only their own FAQs
            faqs = await FAQ.find({ createdBy: user._id }).sort({ createdAt: -1 });
        } else if (user.role === "user") {
            // User gets FAQs of their company admin
            if (!user.createdByWhichCompanyAdmin) {
                return res.status(400).json({
                    status: "error",
                    message: "No company admin assigned to this user",
                });
            }
            faqs = await FAQ.find({
                createdBy: user.createdByWhichCompanyAdmin,
            }).sort({ createdAt: -1 });
        } else {
            return res.status(403).json({
                status: "error",
                message: "Invalid role. Access denied.",
            });
        }

        // 4️⃣ Return data
        res.status(200).json({
            status: "success",
            count: faqs.length,
            data: faqs,
        });
    } catch (error) {
        console.error("❌ Error fetching FAQs:", error);
        res.status(500).json({
            status: "error",
            message: "Server error",
            error: error.message,
        });
    }
};
