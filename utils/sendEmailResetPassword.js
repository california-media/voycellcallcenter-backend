const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, html) => {
  const transporter = nodemailer.createTransport({
    service: 'smtp',
    host: "smtp.titan.email", // SMTP server address
    port: 465, // Port for secure connection
    secure: true, // Use SSL/TLS
    auth: {
      user: 'noreply@contacts.management', // your Gmail address
      pass: 'bZ}JTus_PQ{qWvA'     // app password from Google
      // user: "makvanayash12@gmail.com",
      // pass: "fybb lnri tmrq otmg",
    },
    tls: {
      rejectUnauthorized: false  // THIS LINE FIXES THE ERROR
    }
  });

  //  from: '"Contacts Management" <noreply@contacts.management>',
  //   to: email,
  //   subject: "Contacts.Management : Verify Your E-mail",
  //   html: `<html lang="en">

  await transporter.sendMail({
    from: '"VoyCell Call Center" <noreply@contacts.management>',
    to,
    subject,
    html
  });
};

module.exports = sendEmail;
