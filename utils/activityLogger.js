const logActivityToContact = async (contactId, activityObj) => {
    const Contact = require("../models/contactModel");

    // ✅ Basic validation
    if (!activityObj || !activityObj.type || !activityObj.action) {
        console.error("Invalid activity object:", activityObj);
        return;
    }

    try {
        await Contact.findByIdAndUpdate(contactId, {
            $push: {
                activities: {
                    action: activityObj.action,
                    type: activityObj.type,
                    title: activityObj.title || "",
                    description: activityObj.description || "",
                    timestamp: new Date(),
                },
            },
        });
    } catch (err) {
        console.error("Error logging activity to contact:", err.message);
    }
};

module.exports = { logActivityToContact };
