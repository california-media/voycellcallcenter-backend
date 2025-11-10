const express = require('express');
const router = express.Router();
const {
    redirectToHubSpot, handleHubSpotCallback
} = require('../controllers/hubSpotContectFetchController');

router.get('/', redirectToHubSpot);
router.get('/hubspot/callback', handleHubSpotCallback);

module.exports = router;
