const crypto = require('crypto');
// const bcrypt = require('bcrypt');
const User = require('../models/userModel');
const sendEmail = require('../utils/sendEmailResetPassword');
const sendWhatsAppOtp = require('../utils/sendWhatsAppOtp'); // ✅ Assuming you already have this


// // Forgot Password - Send Reset Link
// exports.forgotPassword = async (req, res) => {
//   const { email } = req.body;

//   try {
//     const user = await User.findOne({ email });

//     if (!user) return res.status(404).json({ message: 'Email not found' });

//     // Generate token
//     const token = crypto.randomBytes(32).toString('hex');
//     user.resetPasswordToken = token;
//     user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
//     await user.save();

//     // Reset link
//     const resetLink = `https://100rjobf76.execute-api.eu-north-1.amazonaws.com/email/reset-password?token=${token}`;

//     console.log("resetLink:", resetLink);


//     // const resetLink = `http://localhost:3003/email/reset-password?token=${token}`;

//     // const html = `
//     //   <p>You requested a password reset.</p>
//     //   <p>Click <a href="${resetLink}">here</a> to reset your password.</p>
//     // `;

//     const html = `
// <!DOCTYPE html>
// <html>
// <head>
//   <meta charset="UTF-8">
//   <title>Reset Your Password</title>
//   <style>
//     body { font-family: Arial, sans-serif; background-color: #f6f9fc; margin: 0; padding: 0; }
//     .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.05); }
//     .header { text-align: center; padding-bottom: 20px; }
//     .header img { width: 120px; }
//     h2 { color: #333333; }
//     p { color: #555555; line-height: 1.6; }
//     .button { display: inline-block; padding: 12px 20px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 6px; margin-top: 20px; }
//     .footer { margin-top: 30px; font-size: 12px; color: #888888; text-align: center; }
//   </style>
// </head>
// <body>
//   <div class="container">
//     <div class="header">
//       <img src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/logoWithName.png" alt="Company Logo">
//     </div>
//     <h2>Password Reset Request</h2>
//     <p>Hello,</p>
//     <p>We received a request to reset your password for your account. If you made this request, please click the button below:</p>
//     <p style="text-align:center;">
//       <a href="${resetLink}" class="button">Reset Password</a>
//     </p>
//     <p>If you didn’t request this, you can safely ignore this email. This password reset link will expire in 1 hour.</p>
//     <div class="footer">
//       <p>&copy; ${new Date().getFullYear()} Contacts Management. All rights reserved.</p>
//     </div>
//   </div>
// </body>
// </html>
// `;


//     await sendEmail(user.email, 'Reset Password', html);

//     res.json({
//       status: "success",
//       message: "Password reset link sent to your email"
//     });
//   } catch (err) {
//     res.status(500).json({ status: "error", message: 'Server error', error: err.message });
//   }
// };

exports.forgotPassword = async (req, res) => {
  try {
    // 1) Normalize & validate incoming email (CHANGED)
    const emailRaw = req.body.email || '';
    const email = String(emailRaw).trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ status: "error", message: "Email is required" });
    }

    // 2) Helper to escape regex special chars (CHANGED)
    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 3) Case-insensitive search (REPLACED)
    //    This works even if the email in DB was saved with mixed case.
    const user = await User.findOne({
      email: { $regex: `^${escapeRegExp(email)}$`, $options: 'i' }
    });

    if (!user) return res.status(404).json({ message: 'Email not found' });

    // Generate token (unchanged)
    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    // Reset link (unchanged)
    const resetLink = `https://demo.contacts.management/email/reset-password?token=${token}`;
    console.log("resetLink:", resetLink);

    // HTML (unchanged from your original)
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Reset Your Password</title>
  <style>
    body { font-family: Arial, sans-serif; background-color: #f6f9fc; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.05); }
    .header { text-align: center; padding-bottom: 20px; }
    .header img { width: 120px; }
    h2 { color: #333333; }
    p { color: #555555; line-height: 1.6; }
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
    .footer { margin-top: 30px; font-size: 12px; color: #888888; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://contacts-api-bucket.s3.eu-north-1.amazonaws.com/iconsAndImages/logoWithName.png" alt="Company Logo">
    </div>
    <h2>Password Reset Request</h2>
    <p>Hello,</p>
    <p>We received a request to reset your password for your account. If you made this request, please click the button below:</p>
    <p style="text-align:center;">
      <a href="${resetLink}" class="button">Reset Password</a>
    </p>
    <p>If you didn’t request this, you can safely ignore this email. This password reset link will expire in 1 hour.</p>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} Contacts Management. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

    await sendEmail(user.email, 'Reset Password', html);

    res.json({
      status: "success",
      message: "Password reset link sent to your email"
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: 'Server error', error: err.message });
  }
};


// Reset Password - Validate token and update password
exports.resetPassword = async (req, res) => {
  const { token } = req.query;
  const { password, confirmPassword } = req.body;

  if (!password || !confirmPassword) {
    return res.status(400).json({ message: 'Password and confirm password are required' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    // // Hash password
    // const saltRounds = 10;
    // const hashedPassword = await bcrypt.hash(password, saltRounds);

    user.password = password;

    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    res.json({
      status: "success",
      message: 'Password has been reset successfully'
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: 'Server error', error: err.message });
  }
};

