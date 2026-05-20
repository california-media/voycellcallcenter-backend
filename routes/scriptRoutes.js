// routes/scriptRoutes.js
const express = require('express');
const router = express.Router();
const { checkForAuthentication } = require('../middlewares/authentication');
const { generateScriptTag, getManagedExtensions } = require('../controllers/scriptController');
const checkAccountStatus = require("../middlewares/checkAccountStatus")


// POST /api/script/generate
router.post('/generate', checkForAuthentication(), checkAccountStatus, generateScriptTag);

// GET /api/script/managed-extensions — all extensions the company admin can route calls to
router.get('/managed-extensions', checkForAuthentication(), checkAccountStatus, getManagedExtensions);

module.exports = router;
