const { Router } = require("express");
const { getDashboardQuickStats } = require("../controllers/dashboardStatsController");
const checkAccountStatus = require("../middlewares/checkAccountStatus");

const router = Router();

// GET /dashboard/quick-stats
router.get("/quick-stats", checkAccountStatus, getDashboardQuickStats);

module.exports = router;
