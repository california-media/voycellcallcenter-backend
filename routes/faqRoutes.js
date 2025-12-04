const express = require("express");
const router = express.Router();
const { addOrEditFAQ, getFAQs, deleteFAQ } = require("../controllers/faqController");
const { checkForAuthentication } = require("../middlewares/authentication");
const checkRole = require("../middlewares/roleCheck");
const checkAccountStatus = require("../middlewares/checkAccountStatus")

// ✅ Middleware for role-based access (example)

// all → can get FAQ
router.get("/get", checkAccountStatus, getFAQs);

// company_admin → can add FAQ
router.post("/addEdit",checkAccountStatus, checkRole(["companyAdmin"]), addOrEditFAQ);

router.delete("/delete",checkAccountStatus, checkRole(["companyAdmin"]), deleteFAQ);

module.exports = router;
