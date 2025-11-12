const express = require("express");
const router = express.Router();
const { addOrEditFAQ, getFAQs, deleteFAQ } = require("../controllers/faqController");
const { checkForAuthentication } = require("../middlewares/authentication");
const checkRole = require("../middlewares/roleCheck");

// ✅ Middleware for role-based access (example)

// all → can get FAQ
router.get("/get", checkForAuthentication(), getFAQs);

// company_admin → can add FAQ
router.post("/addEdit", checkForAuthentication(), checkRole(["companyAdmin"]), addOrEditFAQ);

router.delete("/delete", checkForAuthentication(), checkRole(["companyAdmin"]), deleteFAQ);

module.exports = router;
