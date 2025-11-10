const FAQ = require("../models/faqModel");

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

// ✅ Get all FAQs (for all roles)
exports.getFAQs = async (req, res) => {
    try {
        const faqs = await FAQ.find().sort({ createdAt: -1 });

        res.status(200).json({
            status: "success",
            count: faqs.length,
            data: faqs,
        });
    } catch (error) {
        console.error("Error fetching FAQs:", error);
        res.status(500).json({ status: "error", message: "Server error", error: error.message });
    }
};
