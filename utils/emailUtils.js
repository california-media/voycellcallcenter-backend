require("dotenv").config();
const nodemailer = require("nodemailer");


// MAIL_HOST=smtp.titan.email
// MAIL_PORT=465
// MAIL_USERNAME=noreply@contacts.management
// MAIL_PASSWORD=bZ}JTus_PQ{qWvA


const transporter = nodemailer.createTransport({
    // service: "gmail",
    service: "smtp",
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT),
    secure: false, // Gmail on port 587 uses TLS (not SSL)
    auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
    },
    tls: {
        rejectUnauthorized: false, // important for Gmail on TLS
    },
});

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const sendVerificationEmail = async (email, link) => {
    const mailOptions = {
        from: '"VoyCell Call Center" <noreply@voycell.com>',
        to: email,
        subject: "voyCell : Verify Your E-mail",
        html: `<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>Verify Your VoyCell Call Center Account</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #ffffff;
            color: #2d313a;
            margin: 0;
            padding: 0;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }

        .button {
            display: inline-block;
            background-color: #007bff;
            color: #ffffff !important;
            text-decoration: none;
            padding: 15px 25px;
            border-radius: 5px;
            font-weight: bold;
            margin-top: 20px;
        }

        .social-icons img {
            width: 30px;
            margin: 0 5px;
            vertical-align: middle;
        }

        .app-buttons img {
            width: 120px;
            margin: 10px 5px;
        }

        .footer {
            text-align: center;
            font-size: 14px;
            color: #6c757d;
            margin-top: 30px;
        }

        .footer a {
            color: #007bff;
            text-decoration: none;
        }
    </style>
</head>

<body>
    <div class="container">

        <center> <img src="${FRONTEND_URL}/assets/img/voycell-logo.png"
                    alt="VoyCell Call Center Logo" style="width:200px; display:block;"></center>
        <p><strong>Hello,</strong></p>
        
        <p>Congratulations on creating your <strong>VoyCell Call Center CRM</strong> account — a powerful step toward
            organizing, connecting, and growing your professional network.</p>

        <p>To ensure the security of your account and activate all features, please verify your email address:</p>

        <p><span style="font-size:18px;">👉</span> <a href="${link}" style="color:#007bff;text-decoration:none;">${link}</a></p>

        <p>We look forward to helping you along your journey!</p>

        <p>Warm regards,<br>Contacts Management</p>

        <center><a href="${link}" class="button">VERIFY MY ACCOUNT</a></center>


        <p></p>

        <div style="width:100%; overflow:hidden;">

            <!-- Left Column (Image) -->
            <div style="float:left; width:110px; margin-right:10px;">
                <img src="${FRONTEND_URL}/assets/img/voycell-logo.png"
                    alt="VoyCell Call Center logo" style="width:100px; display:block;">
            </div>

            <!-- Right Column (Text) -->
            <br>
            <div style="overflow:hidden;">

                <span style="color:rgb(45,49,58); font-size:14px; letter-spacing:0.25px;">Be Extraordinary,</span><br>

                <span>
                    <b>VoyCell Call Center Team</b><br>
                    <a href="${FRONTEND_URL}" target="_blank" style="color:#007BFF; text-decoration:none;">
                       ${FRONTEND_URL}
                    </a>
                </span>

            </div>

        </div>



        <div class="footer">
            <p>Follow Contacts Management social media on:</p>
            <div class="social-icons">
                <a href="#"><img
                        src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/facebookIcon.png"
                        alt="Facebook"></a>
                <a href="#"><img src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/instagramIcon.png"
                        alt="Instagram"></a>
                <a href="#"><img src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/linkedinIcon.png"
                        alt="linkedin"></a>
                <a href="#"><img
                        src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/twitterIcon.png"
                        alt="Twitter"></a>
                <a href="#"><img
                        src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/youtubeIcon.png"
                        alt="YouTube"></a>
            </div>
            <br><br>
            <div class="app-buttons">
                <p>Download the Contacts Managementt App:</p>
                <a href="#"><img
                        src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/appStoreIcon.png"
                        alt="App Store"></a>
                <a href="#"><img
                        src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/playStoreIcon.png"
                        alt="Google Play"></a>
            </div>

            <p>Need help? Visit <a href="#">support@VoyCell</a> </p>
            <p>Sent with ❤️ from VoyCell</p>
            <p><a href="#" target="_blank">Privacy Policy</a></p>
        </div>
    </div>
</body>

</html>`,
    };

    await transporter.sendMail(mailOptions);
};

// const sendHelpSupportReply = async (
//   userEmail,
//   userName,
//   originalMessage,
//   adminReply,
//   subject
// ) => {
//   const mailOptions = {
//     from: '"Contacts Management Support" <noreply@contacts.management>',
//     to: userEmail,
//     subject: `Re: ${subject || "Your Support Request"}`,
//     html: `<html lang="en">

// <head>
//     <meta charset="UTF-8">
//     <title>Support Response - Contacts Management</title>
//     <style>
//         body {
//             font-family: Arial, sans-serif;
//             background-color: #ffffff;
//             color: #2d313a;
//             margin: 0;
//             padding: 0;
//         }

//         .container {
//             max-width: 600px;
//             margin: 0 auto;
//             padding: 20px;
//         }

//         .response-box {
//             background-color: #f8f9fa;
//             border-left: 4px solid #007bff;
//             padding: 15px;
//             margin: 20px 0;
//         }

//         .original-message {
//             background-color: #e9ecef;
//             padding: 15px;
//             margin: 20px 0;
//             border-radius: 5px;
//         }

//         .footer {
//             text-align: center;
//             font-size: 14px;
//             color: #6c757d;
//             margin-top: 30px;
//         }

//         .footer a {
//             color: #007bff;
//             text-decoration: none;
//         }
//     </style>
// </head>

// <body>
//     <div class="container">
//         <center>
//             <img src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/logoWithName.png"
//                 alt="Contacts Management Logo" style="width:200px; display:block;">
//         </center>

//         <p><strong>Hello ${userName || "Valued Customer"},</strong></p>

//         <p>Thank you for contacting Contacts Management support. We have reviewed your inquiry and are pleased to provide you with the following response:</p>

//         <div class="response-box">
//             <h3 style="color: #007bff; margin-top: 0;">Support Response:</h3>
//             <p style="white-space: pre-wrap;">${adminReply}</p>
//         </div>

//         <div class="original-message">
//             <h4 style="margin-top: 0;">Your Original Message:</h4>
//             <p style="white-space: pre-wrap;">${originalMessage}</p>
//         </div>

//         <p>If you have any additional questions or concerns, please don't hesitate to reach out to us again. We're here to help!</p>

//         <p>Best regards,<br>Contacts Management Support Team</p>

//         <div style="width:100%; overflow:hidden; margin-top: 30px;">
//             <div style="float:left; width:110px; margin-right:10px;">
//                 <img src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/logo.png"
//                     alt="Contacts Management Logo" style="width:100px; display:block;">
//             </div>
//             <div style="overflow:hidden;">
//                 <span style="color:rgb(45,49,58); font-size:14px; letter-spacing:0.25px;">Be Extraordinary,</span><br>
//                 <span>
//                     <b>Contacts Management Support Team</b><br>
//                     <a href="https://contacts.management" target="_blank" style="color:#007BFF; text-decoration:none;">
//                         https://contacts.management
//                     </a>
//                 </span>
//             </div>
//         </div>

//         <div class="footer">
//             <p>Need additional help? Contact us at <a href="mailto:support@contacts.management">support@contacts.management</a></p>
//             <p>Sent with ❤️ from Contacts Management</p>
//             <p><a href="#" target="_blank">Privacy Policy</a></p>
//         </div>
//     </div>
// </body>

// </html>`,
//   };

//   await transporter.sendMail(mailOptions);
// };

const sendHelpSupportReplyNotification = async (
    userEmail,
    userName,
    subject,
    adminMessage,
    ticketId
) => {
    const ticketsPageUrl = `${process.env.FRONTEND_URL || "https://contacts.management"
        }/my-tickets?ticketId=${ticketId}`;

    const mailOptions = {
        from: '"Contacts Management Support" <noreply@contacts.management>',
        to: userEmail,
        subject: `New Reply: ${subject || "Your Support Request"}`,
        html: `<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>New Reply - Contacts Management</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #ffffff;
            color: #2d313a;
            margin: 0;
            padding: 0;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }

        .notification-box {
            background-color: #e8f5e8;
            border-left: 4px solid #28a745;
            padding: 15px;
            margin: 20px 0;
        }

        .message-box {
            background-color: #f8f9fa;
            border-left: 4px solid #007bff;
            padding: 15px;
            margin: 20px 0;
        }

        .cta-button {
            display: inline-block;
            background-color: #007bff;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: bold;
        }

        .footer {
            text-align: center;
            font-size: 14px;
            color: #6c757d;
            margin-top: 30px;
        }

        .footer a {
            color: #007bff;
            text-decoration: none;
        }
    </style>
</head>

<body>
    <div class="container">
        <center>
            <img src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/logoWithName.png"
                alt="Contacts Management Logo" style="width:200px; display:block;">
        </center>

        <p><strong>Hello ${userName || "Valued Customer"},</strong></p>

        <div class="notification-box">
            <h3 style="color: #28a745; margin-top: 0;">🎉 You've received a new reply!</h3>
            <p>Our support team has responded to your ticket: <strong>${subject}</strong></p>
        </div>

        <div class="message-box">
            <h4 style="color: #007bff; margin-top: 0;">Latest Reply:</h4>
            <p style="white-space: pre-wrap;">${adminMessage}</p>
        </div>

        <center>
            <a href="${ticketsPageUrl}" class="cta-button" style="color: white;">View Conversation & Reply</a>
        </center>

        <p>Click the button above to view the full conversation and continue chatting with our support team.</p>

        <p>Best regards,<br>Contacts Management Support Team</p>

        <div style="width:100%; overflow:hidden; margin-top: 30px;">
            <div style="float:left; width:110px; margin-right:10px;">
                <img src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/logo.png"
                    alt="Contacts Management Logo" style="width:100px; display:block;">
            </div>
            <div style="overflow:hidden;">
                <span style="color:rgb(45,49,58); font-size:14px; letter-spacing:0.25px;">Be Extraordinary,</span><br>
                <span>
                    <b>Contacts Management Support Team</b><br>
                    <a href="https://contacts.management" target="_blank" style="color:#007BFF; text-decoration:none;">
                        https://contacts.management
                    </a>
                </span>
            </div>
        </div>

        <div class="footer">
            <p>Need additional help? Contact us at <a href="mailto:support@contacts.management">support@contacts.management</a></p>
            <p>Sent with ❤️ from Contacts Management</p>
            <p><a href="#" target="_blank">Privacy Policy</a></p>
        </div>
    </div>
</body>

</html>`,
    };

    await transporter.sendMail(mailOptions);
};

const sendEmailChangeVerification = async (
    newEmail,
    oldEmail,
    userName,
    userId,
    verificationLink
) => {
    const mailOptions = {
        from: '"VoyCell Call Center" <noreply@contacts.management>',
        to: newEmail,
        subject: "VoyCell: Verify Your New Email Address",
        html: `<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>Verify Your New Email Address</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #ffffff;
            color: #2d313a;
            margin: 0;
            padding: 0;
        }

        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }

        .info-box {
            background-color: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 5px;
        }

        .button {
            display: inline-block;
            background-color: #007bff;
            color: #ffffff !important;
            text-decoration: none;
            padding: 15px 25px;
            border-radius: 5px;
            font-weight: bold;
            margin-top: 20px;
        }

        .social-icons img {
            width: 30px;
            margin: 0 5px;
            vertical-align: middle;
        }

        .app-buttons img {
            width: 120px;
            margin: 10px 5px;
        }

        .footer {
            text-align: center;
            font-size: 14px;
            color: #6c757d;
            margin-top: 30px;
        }

        .footer a {
            color: #007bff;
            text-decoration: none;
        }
    </style>
</head>

<body>
    <div class="container">

        <center> <img src="${FRONTEND_URL}/assets/img/voycell-logo.png"
                    alt="VoyCell Call Center Logo" style="width:200px; display:block;"></center>
        <p><strong>Hello ${userName || "User"},</strong></p>
        
        <p>Your VoyCell Call Center account email address has been updated by the system administrator.</p>

        <div class="info-box">
            <h4 style="margin-top: 0;">Email Change Details:</h4>
            <p style="margin: 5px 0;"><strong>Account:</strong> ${userName || userId
            }</p>
            <p style="margin: 5px 0;"><strong>Previous Email:</strong> ${oldEmail}</p>
            <p style="margin: 5px 0;"><strong>New Email:</strong> ${newEmail}</p>
        </div>

        <p>To complete this email change and ensure the security of your account, please verify your new email address by clicking the button below:</p>

        <center><a href="${verificationLink}" class="button">VERIFY NEW EMAIL ADDRESS</a></center>

        <p style="margin-top: 20px;">Or copy and paste this link into your browser:</p>
        <p><span style="font-size:18px;">👉</span> <a href="${verificationLink}" style="color:#007bff;text-decoration:none;word-break:break-all;">${verificationLink}</a></p>

        <p><strong>Important:</strong> If you did not request this change or believe this is an error, please contact your administrator immediately.</p>

        <p>Warm regards,<br>VoyCell Call Center Team</p>

        <div style="width:100%; overflow:hidden;">

            <!-- Left Column (Image) -->
            <div style="float:left; width:110px; margin-right:10px;">
                <img src="${FRONTEND_URL}/assets/img/voycell-logo.png"
                    alt="VoyCell Call Center logo" style="width:100px; display:block;">
            </div>

            <!-- Right Column (Text) -->
            <br>
            <div style="overflow:hidden;">

                <span style="color:rgb(45,49,58); font-size:14px; letter-spacing:0.25px;">Be Extraordinary,</span><br>

                <span>
                    <b>VoyCell Call Center Team</b><br>
                    <a href="${FRONTEND_URL}" target="_blank" style="color:#007BFF; text-decoration:none;">
                       ${FRONTEND_URL}
                    </a>
                </span>

            </div>

        </div>

        <div class="footer">
            <p>Follow Contacts Management social media on:</p>
            <div class="social-icons">
                <a href="#"><img
                        src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/facebookIcon.png"
                        alt="Facebook"></a>
                <a href="#"><img src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/instagramIcon.png"
                        alt="Instagram"></a>
                <a href="#"><img src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/linkedinIcon.png"
                        alt="linkedin"></a>
                <a href="#"><img
                        src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/twitterIcon.png"
                        alt="Twitter"></a>
                <a href="#"><img
                        src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/youtubeIcon.png"
                        alt="YouTube"></a>
            </div>
            <br><br>
            <div class="app-buttons">
                <p>Download the Contacts Managementt App:</p>
                <a href="#"><img
                        src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/appStoreIcon.png"
                        alt="App Store"></a>
                <a href="#"><img
                        src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/playStoreIcon.png"
                        alt="Google Play"></a>
            </div>

            <p>Need help? Visit <a href="#">support@VoyCell</a> </p>
            <p>Sent with ❤️ from VoyCell</p>
            <p><a href="#" target="_blank">Privacy Policy</a></p>
        </div>
    </div>
</body>

</html>`,
    };

    await transporter.sendMail(mailOptions);
};

const sendMagicLinkEmail = async (email, link) => {
    const mailOptions = {
        from: '"VoyCell Call Center" <noreply@voycell.com>',
        to: email,
        subject: "VoyCell Secure Magic Login Link",
        html: `
    <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #ffffff;
          color: #2d313a;
          padding: 0;
          margin: 0;
        }
        .container {
          max-width: 600px;
          margin: auto;
          padding: 20px;
        }
        .button {
          background: #4CAF50;
          color: #fff !important;
          padding: 14px 24px;
          text-decoration: none;
          border-radius: 6px;
          font-weight: bold;
          display: inline-block;
        }
        .footer {
          font-size: 13px;
          color: #6c757d;
          margin-top: 30px;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">

        <center>
          <img src="${process.env.FRONTEND_URL}/assets/img/voycell-logo.png" style="width:180px;" />
        </center>

        <h2>Login to VoyCell using Magic Link</h2>

        <p>Hello,</p>

        <p>You requested a secure magic link to log into your VoyCell account.</p>

        <p><b>This link will expire in 10 minutes and can only be used once.</b></p>

        <center>
        <div style="margin: 20px 0;">${link}</div>
        <div>
            <a href="${link}" class="button">Login Securely</a>
        </div>
        </center>

        <p>If you did not request this login, you can safely ignore this email.</p>

        <div class="footer">
          <p>VoyCell Call Center Team</p>
          <p>${process.env.FRONTEND_URL}</p>
        </div>

      </div>
    </body>
    </html>
    `,
    };

    await transporter.sendMail(mailOptions);
};

module.exports = {
    sendVerificationEmail,
    //   sendHelpSupportReply,
    sendHelpSupportReplyNotification,
    sendEmailChangeVerification,
    sendMagicLinkEmail,
};
