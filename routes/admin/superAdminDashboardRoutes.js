const express = require("express");
const router = express.Router();
const { checkForAuthentication } = require("../../middlewares/authentication");
const checkRole = require("../../middlewares/roleCheck");
const { getSuperAdminDashboardStats } = require("../../controllers/admin/superAdminDashboardController");

// GET /admin/dashboard-stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get("/dashboard-stats", checkForAuthentication(), checkRole(["superadmin"]), getSuperAdminDashboardStats);

module.exports = router;
