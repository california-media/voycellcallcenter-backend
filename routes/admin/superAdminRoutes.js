// routes/superAdminRoutes.js
const express = require("express");
const router = express.Router();
const { getAllCompanyAdminsWithAgents } = require("../../controllers/admin/superAdminController");

// Super Admin only
router.get("/companyAdmin-agents", getAllCompanyAdminsWithAgents);

module.exports = router;
