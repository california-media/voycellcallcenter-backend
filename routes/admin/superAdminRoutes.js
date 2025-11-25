// routes/superAdminRoutes.js
const express = require("express");
const router = express.Router();
const { getAgentDetails, getCompanyAdminDetails, getAgentsOfCompanyAdmin, getAllCompanyAdmins, editCompanyAdminAndAgent } = require("../../controllers/admin/superAdminController");

// Super Admin only
router.post("/allCompanyAdmin", getAllCompanyAdmins);

router.post("/companyAdminDetailsById", getCompanyAdminDetails);

router.post("/allAgentsOfCompanyAdmin", getAgentsOfCompanyAdmin);

router.post("/agentDetailsById", getAgentDetails);

router.put("/editCompanyAdminAndAgent", editCompanyAdminAndAgent)

module.exports = router;
