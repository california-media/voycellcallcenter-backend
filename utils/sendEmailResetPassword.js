require("dotenv").config();
const nodemailer = require("nodemailer");

const sendEmail = async (to, subject, html) => {
  const transporter = nodemailer.createTransport({
    service: "smtp",
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT),
    secure: true, // Gmail on port 587 uses TLS (not SSL)
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false, // important for Gmail on TLS
    },
  });

  //  from: '"Contacts Management" <noreply@contacts.management>',
  //   to: email,
  //   subject: "Contacts.Management : Verify Your E-mail",
  //   html: `<html lang="en">

  await transporter.sendMail({
    from: '"VoyCell Call Center" <noreply@contacts.management>',
    to,
    subject,
    html,
  });
};

module.exports = sendEmail;
