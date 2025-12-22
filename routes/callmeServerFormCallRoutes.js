// routes/callmeServeRoute.js
const express = require('express');
const router = express.Router();
const { serveFormCallJS } = require('../controllers/callmeFormCallController');

router.get('/:token', serveFormCallJS);

module.exports = router;
