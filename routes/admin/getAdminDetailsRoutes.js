const express = require("express");
const { getAdminDetails } = require("../../controllers/admin/getAdminDetailsController");
// const { authenticateAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/admin/details
router.get("/details", getAdminDetails);

module.exports = router;
