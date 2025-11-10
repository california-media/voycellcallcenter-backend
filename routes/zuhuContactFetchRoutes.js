const express = require('express');
const router = express.Router();
const {
    redirectToZoho,
    handleZohoCallback
} = require('../controllers/zuhuContactFetchController');

router.get('/', redirectToZoho);
router.get('/zoho/callback', handleZohoCallback);

module.exports = router;
