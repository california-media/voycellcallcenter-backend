// routes/scriptRoutes.js
const express = require('express');
const router = express.Router();
const { checkForAuthentication } = require('../middlewares/authentication');
const { generateScriptTag } = require('../controllers/scriptController');

// POST /api/script/generate
// body optional: themeColor, popupHeading, popupText, calltoaction
router.post('/generate', checkForAuthentication(), generateScriptTag);

module.exports = router;
