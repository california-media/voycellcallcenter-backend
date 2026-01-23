const express = require('express');
const router = express.Router();
const checkAccountStatus = require("../middlewares/checkAccountStatus")


const {
    redirectToGoogle,
    handleGoogleCallback,
} = require('../controllers/googleContactFatchController');

// Step 1: Trigger Google OAuth
router.get('/', checkAccountStatus, redirectToGoogle);

// Step 2: Handle redirect and return contacts
router.get('/google/callback', handleGoogleCallback);

module.exports = router;
