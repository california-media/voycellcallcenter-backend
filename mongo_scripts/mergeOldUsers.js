const mongoose = require("mongoose");
const User = require("../models/userModel");

mongoose.connect("mongodb+srv://voycellcallcenterdb:IskIIdZUSk4QsyMA@cluster0.lrzweyr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0");

async function fixLeadStatuses() {
    const users = await User.find({
        $or: [
            { leadStatuses: { $exists: false } },
            { "leadStatuses.group": { $exists: false } },
        ],
    });

    console.log("Users to fix:", users.length);

    for (const user of users) {
        user.leadStatuses = [
            { value: "interested", label: "Interested", group: 1, isDefault: true },
            { value: "followup", label: "Follow Up", group: 2, isDefault: true },
            { value: "win", label: "Win", group: 3, isDefault: true },
            { value: "lost", label: "Lost", group: 3, isDefault: false },
        ];

        await user.save({ validateBeforeSave: true });
    }

    console.log("✅ leadStatuses fixed successfully");
    process.exit();
}

fixLeadStatuses();
