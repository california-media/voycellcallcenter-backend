const express = require('express');
const router = express.Router();
const {
    getReminders,
    addEditReminder,
    deleteReminder,
} = require('../controllers/reminderController');

// GET /reminders/:userId
router.get('/getReminders', getReminders);

// POST /reminders/:userId
router.post('/addEditReminder', addEditReminder);

// DELETE /reminders/:userId/:reminderId
router.delete('/deleteReminder', deleteReminder);

module.exports = router;
