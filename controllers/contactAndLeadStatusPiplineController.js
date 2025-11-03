const Contact = require("../models/contactModel");
const Pipeline = require("../models/Pipeline");

// 🟢 1️⃣ Change status — convert to lead + create pipeline
exports.changeStatus = async (req, res) => {
    try {
        const { contact_id } = req.body;
        const { newStatus, note } = req.body;
        const userId = req.user?._id;

        if (!newStatus)
            return res.status(400).json({ message: "Status is required" });

        const contact = await Contact.findById(contact_id);
        if (!contact)
            return res.status(404).json({ message: "Contact not found" });

        const oldStatus = contact.status;

        // 🧠 Convert contact → lead if status is "interested"
        if (newStatus === "interested" && !contact.isLead) {
            contact.isLead = true;
            console.log(`🔄 Contact ${contact._id} converted to lead`);
        }

        contact.status = newStatus;
        await contact.save();

        // 📈 Create pipeline only for leads
        if (contact.isLead && ["interested", "contacted", "win", "lost"].includes(newStatus)) {
            await Pipeline.create({
                lead_id: contact._id,
                previousStatus: oldStatus,
                currentStatus: newStatus,
                changedBy: userId,
                note,
            });
        }

        res.status(200).json({
            message: "Status updated successfully",
            status: "success",
            data: contact,
        });
    } catch (error) {
        console.error("❌ changeStatus error:", error);
        res.status(500).json({ message: "Internal server error", error });
    }
};

// 🟣 2️⃣ Get pipeline for a specific lead
exports.getPipeline = async (req, res) => {
    try {
        const { lead_id } = req.body;

        const pipeline = await Pipeline.find({ lead_id: lead_id })
            .populate("changedBy", "firstname lastname email")
            .sort({ createdAt: 1 });

        res.status(200).json({
            message: "Lead pipeline fetched successfully",
            status: "success",
            data: pipeline,
        });
    } catch (error) {
        console.error("❌ getPipeline error:", error);
        res.status(500).json({ message: "Internal server error", error });
    }
};

// 🟡 3️⃣ Get all leads grouped by current pipeline status
exports.getPipelineOverview = async (req, res) => {
    try {
        const leads = await Contact.aggregate([
            { $match: { isLead: true } },
            {
                $group: {
                    _id: "$status",
                    total: { $sum: 1 },
                    leads: {
                        $push: {
                            _id: "$_id",
                            firstname: "$firstname",
                            lastname: "$lastname",
                            email: "$emailAddresses",
                            company: "$company",
                            status: "$status",
                        },
                    },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        res.status(200).json({
            message: "Pipeline overview fetched successfully",
            status: "success",
            data: leads,
        });
    } catch (error) {
        console.error("❌ getPipelineOverview error:", error);
        res.status(500).json({ message: "Internal server error", error });
    }
};
