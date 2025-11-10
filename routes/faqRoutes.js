const express = require("express");
const router = express.Router();
const { addFAQ, getFAQs } = require("../controllers/faqController");
const { checkForAuthentication } = require("../middlewares/authentication");
const checkRole = require("../middlewares/roleCheck");

// ✅ Middleware for role-based access (example)

// all → can get FAQ
router.get("/get", checkForAuthentication(), getFAQs);


// company_admin → can add FAQ
router.post("/add", checkForAuthentication(), checkRole(["companyAdmin"]), addFAQ);


module.exports = router;
