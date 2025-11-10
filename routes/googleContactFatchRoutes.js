const express = require('express');
const router = express.Router();

const {
    redirectToGoogle,
    handleGoogleCallback,
} = require('../controllers/googleContactFatchController');

// Step 1: Trigger Google OAuth
router.get('/', redirectToGoogle);

// Step 2: Handle redirect and return contacts
router.get('/google/callback', handleGoogleCallback);

module.exports = router;
