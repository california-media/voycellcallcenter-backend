const express = require('express');
const router = express.Router();
const checkAccountStatus = require("../middlewares/checkAccountStatus")


const disconnectAccountControllers = require('../controllers/disconnectAccountControllers');

router.post('/google',checkAccountStatus, disconnectAccountControllers.disconnectGoogle);

router.post('/microsoft',checkAccountStatus, disconnectAccountControllers.disconnectMicrosoft);

router.post('/smtp',checkAccountStatus, disconnectAccountControllers.disconnectSMTP);


module.exports = router;
