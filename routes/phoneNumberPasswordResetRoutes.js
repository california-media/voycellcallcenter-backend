const express = require('express');
const router = express.Router();
const phoneNumberPasswordResetController = require('../controllers/phoneNumberPasswordResetController');

router.post('/forgot-password', phoneNumberPasswordResetController.forgotPasswordPhone)

router.post('/reset-password', phoneNumberPasswordResetController.resetPasswordPhone);

module.exports = router;
