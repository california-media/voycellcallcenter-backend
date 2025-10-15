const express = require("express");
const router = express.Router();
const { superadminLogin } = require("../../controllers/admin/adminLoginController");

// POST /api/superadmin/login
router.post("/", superadminLogin);

module.exports = router;
