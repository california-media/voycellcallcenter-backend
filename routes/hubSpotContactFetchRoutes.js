const express = require('express');
const router = express.Router();
const {
    redirectToHubSpot, handleHubSpotCallback
} = require('../controllers/hubSpotContectFetchController');
const checkAccountStatus = require("../middlewares/checkAccountStatus")

router.get('/', checkAccountStatus,redirectToHubSpot);
router.get('/hubspot/callback', handleHubSpotCallback);

module.exports = router;
