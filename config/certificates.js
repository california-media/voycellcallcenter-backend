const path = require("path");
const fs = require("fs");

const CERTIFICATE_PATH = path.resolve(__dirname, "../certificates/certificate.pem");
const PRIVATE_KEY_PATH = path.resolve(__dirname, "../certificates/private_key.pem");
const WWDR_PATH = path.resolve(__dirname, "../certificates/WWDR.pem");


if (![CERTIFICATE_PATH, PRIVATE_KEY_PATH, WWDR_PATH].every(fs.existsSync)) {
    console.error("❌ Missing required certificate files. Please check your setup.");
    process.exit(1);
}

module.exports = { CERTIFICATE_PATH, PRIVATE_KEY_PATH, WWDR_PATH };
