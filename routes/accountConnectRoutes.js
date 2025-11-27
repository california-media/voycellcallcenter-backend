const express = require('express');
const router = express.Router();
const accountConnectController = require('../controllers/accountConnectController');
const checkAccountStatus = require("../middlewares/checkAccountStatus")


router.post('/google', checkAccountStatus, accountConnectController.connectGoogle);
router.get('/google-callback', accountConnectController.googleCallback);
router.post('/microsoft', checkAccountStatus, accountConnectController.connectMicrosoft);
router.get('/microsoft-callback', accountConnectController.microsoftCallback);
router.post('/smtp', checkAccountStatus, accountConnectController.connectSMTP);

module.exports = router;
