const express = require('express');
const router = express.Router();
const pipedriveController = require('../controllers/pipedriveController');

// This starts the process
router.get('/startAuth', pipedriveController.startAuth);

// Pipedrive will send the user back to this URL
router.get('/callback', pipedriveController.handleCallback);

router.get('/embed', pipedriveController.embed);

// // This is the page that will actually show INSIDE the Pipedrive window
// router.get('/panel', (req, res) => {
//     res.sendFile(__dirname + '/../views/pipedrive-panel.html');
// });

module.exports = router;