require("dotenv").config();
const nodemailer = require("nodemailer");
const { getConfig } = require("./getConfig");

const sendEmail = async (to, subject, html) => {
  const {MAIL_HOST,MAIL_PORT, MAIL_USERNAME} = getConfig()
  const transporter = nodemailer.createTransport({
    service: "smtp",
    // service: "gmail",
    // host: process.env.MAIL_HOST,
    host: MAIL_HOST,
    // port: Number(process.env.MAIL_PORT),
    port: Number(MAIL_PORT),
    secure: false, // Gmail on port 587 uses TLS (not SSL)
    auth: {
      user: MAIL_USERNAME,
      // user: process.env.MAIL_USERNAME,
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
    from: '"VOYCELL" <noreply@voycell.com>',
    to,
    subject,
    html,
  });
};

module.exports = sendEmail;
