// routes/yeastar.js
const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const User = require('../models/userModel');

// use raw or json parser depending on Yeastar payload type
router.post('/webhook', bodyParser.json(), async (req, res) => {
  try {
    const payload = req.body;
    // payload will include event type, extension, call info, etc.
    // log it
    console.log('Yeastar webhook:', JSON.stringify(payload).slice(0,2000));

    // Example: if payload contains extension and event type 'call' you can find User
    // Adjust logic per the exact event structure your PBX sends.
    const extension = payload.extension || payload.data?.extension || null;
    const eventType = payload.event || payload.type || payload.action;

    if (extension && eventType) {
      const user = await User.findOne({ extensionNumber: String(extension) });
      if (user) {
        // append an activity (or whatever you want)
        user.activities = user.activities || [];
        user.activities.push({
          action: `pbx_${eventType}`,
          description: JSON.stringify(payload).substring(0, 2000),
          timestamp: new Date(),
        });
        await user.save();
      }
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook handling error:', err);
    return res.status(500).json({ status: 'error' });
  }
});

module.exports = router;
