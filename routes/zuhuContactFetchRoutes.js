const express = require('express');
const router = express.Router();
const {
    redirectToZoho,
    handleZohoCallback
} = require('../controllers/zuhuContactFetchController');
const checkAccountStatus = require("../middlewares/checkAccountStatus")

router.get('/', checkAccountStatus, redirectToZoho);
router.get('/zoho/callback', handleZohoCallback);

module.exports = router;
