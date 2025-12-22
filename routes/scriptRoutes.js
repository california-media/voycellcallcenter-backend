// routes/scriptRoutes.js
const express = require('express');
const router = express.Router();
const { checkForAuthentication } = require('../middlewares/authentication');
const { generateScriptTag, generateFormCallScriptTag } = require('../controllers/scriptController');
const checkAccountStatus = require("../middlewares/checkAccountStatus")


// POST /api/script/generate
// body optional: themeColor, popupHeading, popupText, calltoaction
router.post('/generate', checkForAuthentication(), checkAccountStatus, generateScriptTag);

router.post('/generateFormCall', checkForAuthentication(), checkAccountStatus, generateFormCallScriptTag);

module.exports = router;
