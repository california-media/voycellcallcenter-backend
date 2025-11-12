const mongoose = require("mongoose");
const FAQ = require("../models/faqModel");
const User = require("../models/userModel");


// // ✅ Add FAQ (company_admin only)
// exports.addFAQ = async (req, res) => {
//     try {
//         const { question, answer } = req.body;

//         if (!question || !answer) {
//             return res.status(400).json({ message: "Question and answer are required" });
//         }

//         const faq = await FAQ.create({
//             question,
//             answer,
//             createdBy: req.user._id, // assuming JWT middleware sets req.user
//         });

//         res.status(201).json({
//             status: "success",
//             message: "FAQ Added",
//             data: faq,
//         });
//     } catch (error) {
//         console.error("Error adding FAQ:", error);
//         res.status(500).json({ status: "error", message: "Server error", error: error.message });
//     }
// };

// ✅ Add or Edit FAQ (companyAdmin only)
exports.addOrEditFAQ = async (req, res) => {
    try {
        const userId = req.user._id;

        // 🧠 Step 1: Verify user role
        const user = await User.findById(userId);
        if (!user || user.role !== "companyAdmin") {
            return res.status(403).json({ message: "Access denied. Only company admins can perform this action." });
        }

        const { faqId, question, answer } = req.body;

        // 🧩 Step 2: Validate inputs
        if (!question || !answer) {
            return res.status(400).json({ message: "Question and answer are required" });
        }

        let faq;

        if (faqId) {
            // ✏️ Edit existing FAQ
            if (!mongoose.Types.ObjectId.isValid(faqId)) {
                return res.status(400).json({ message: "Invalid FAQ ID" });
            }

            faq = await FAQ.findById(faqId);
            if (!faq) {
                return res.status(404).json({ message: "FAQ not found" });
            }

            // Optional: Ensure only the same company admin who created it can edit
            if (faq.createdBy.toString() !== userId.toString()) {
                return res.status(403).json({ message: "You can only edit FAQs you created" });
            }

            faq.question = question;
            faq.answer = answer;
            await faq.save();

            return res.status(200).json({
                status: "success",
                message: "FAQ updated",
                data: faq,
            });
        } else {
            // 🆕 Create new FAQ
            faq = await FAQ.create({
                question,
                answer,
                createdBy: userId,
            });

            return res.status(201).json({
                status: "success",
                message: "FAQ added",
                data: faq,
            });
        }
    } catch (error) {
        console.error("Error in addOrEditFAQ:", error);
        res.status(500).json({
            status: "error",
            message: "Server error",
            error: error.message,
        });
    }
};

// ❌ Delete FAQ (companyAdmin only)
exports.deleteFAQ = async (req, res) => {
    try {
        const userId = req.user._id;
        const { faqId } = req.body;

        // 🧠 Step 1: Verify role
        const user = await User.findById(userId);
        if (!user || user.role !== "companyAdmin") {
            return res.status(403).json({ message: "Access denied. Only company admins can perform this action." });
        }

        // 🧩 Step 2: Validate faqId
        if (!mongoose.Types.ObjectId.isValid(faqId)) {
            return res.status(400).json({ message: "Invalid FAQ ID" });
        }

        const faq = await FAQ.findById(faqId);
        if (!faq) {
            return res.status(404).json({ message: "FAQ not found" });
        }

        // Optional: only creator can delete
        if (faq.createdBy.toString() !== userId.toString()) {
            return res.status(403).json({ message: "You can only delete FAQs you created" });
        }

        await FAQ.findByIdAndDelete(faqId);

        res.status(200).json({
            status: "success",
            message: "FAQ deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting FAQ:", error);
        res.status(500).json({
            status: "error",
            message: "Server error",
            error: error.message,
        });
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
