const express = require('express');
const router = express.Router();
const pipedriveController = require('../controllers/pipedriveController');

// This starts the process
router.get('/startAuth', pipedriveController.startAuth);

// Pipedrive will send the user back to this URL
router.get('/callback', pipedriveController.handleCallback);

router.get('/embed', pipedriveController.embed);

// routes file
router.get('/pipedrive-bridge', pipedriveController.pipedriveBridge);


module.exports = router;