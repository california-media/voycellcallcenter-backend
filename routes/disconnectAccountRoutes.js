const express = require('express');
const router = express.Router();


const disconnectAccountControllers = require('../controllers/disconnectAccountControllers');

router.post('/google', disconnectAccountControllers.disconnectGoogle);

router.post('/microsoft', disconnectAccountControllers.disconnectMicrosoft);

router.post('/smtp', disconnectAccountControllers.disconnectSMTP);


module.exports = router;
