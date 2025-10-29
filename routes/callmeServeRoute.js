// routes/callmeServeRoute.js
const express = require('express');
const router = express.Router();
const { serveCallmeJS } = require('../controllers/callmeController');

// GET /callback_system/callme.js?ext=...&themeColor=...&popupHeading=...&popupText=...&calltoaction=...
router.get('/:token', serveCallmeJS);

module.exports = router;
