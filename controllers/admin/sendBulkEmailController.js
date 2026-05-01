const { transporter } = require("../../utils/emailUtils");

const stripHtml = (html) =>
    html.replace(/<[^>]*>/g, "").trim();


exports.sendBulkEmail = async (req, res) => {
    try {
        const { email_subject, email_body, details } = req.body;
        const copy_to = "waqar.78692@gmail.com";

        if (!email_subject || !email_body) {
            return res.status(400).json({
                success: false,
                message: "Email subject and body are required",
            });
        }

        if (!Array.isArray(details) || details.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Details array is required",
            });
        }

        const cleanSubject = stripHtml(email_subject);

        // Replace all {{fieldName}} placeholders with matching keys from each
        // recipient object. Keys matched case-insensitively.
        const applyFields = (text, user) =>
            text.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
                const val = user[key] ?? user[key.toLowerCase()] ?? "";
                return String(val).trim();
            });

        const emailPromises = details.map((user) =>
            transporter.sendMail({
                from: `"California Media" <waqar@californiamedia.ae>`,
                to: user.email,
                subject: applyFields(cleanSubject, user),
                html:    applyFields(email_body,   user),
            })
        );

        await Promise.all(emailPromises);

        // Send silent copy to monitoring address
        if (copy_to) {
            console.log(`[CopyTo] Sending silent copy to ${copy_to}`);
            transporter.sendMail({
                from:    `"California Media" <noreply@californiamedia.ae>`,
                to:      copy_to,
                subject: cleanSubject,
                html:    email_body,
            })
              .then(() => console.log(`[CopyTo] ✅ Silent copy delivered to ${copy_to}`))
              .catch((err) => console.error(`[CopyTo] ❌ Failed:`, err.message));
        }

        return res.status(200).json({
            success: true,
            message: "Emails sent successfully",
            totalEmails: details.length,
        });
    } catch (error) {
        console.error("Bulk email error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send emails",
            error: error.message,
        });
    }
};
