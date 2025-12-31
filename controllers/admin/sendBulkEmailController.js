const { transporter } = require("../../utils/emailUtils");

const stripHtml = (html) =>
    html.replace(/<[^>]*>/g, "").trim();


exports.sendBulkEmail = async (req, res) => {
    try {
        const { email_subject, email_body, details } = req.body;

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


        const emailPromises = details.map((user) =>
            transporter.sendMail({
                from: `"California Media" <noreply@californiamedia.ae>`,
                to: user.email,
                subject: cleanSubject,
                html: email_body.replace("{{name}}", user.name || "User"),
            })
        );

        await Promise.all(emailPromises);

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
