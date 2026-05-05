// SES/SNS infrastructure (config set "voycell-email-tracking", SNS topic
// "voycell-email-events", and webhook subscription) is managed once via the
// AWS console. No SDK clients needed at runtime — tracking works through the
// X-SES-CONFIGURATION-SET SMTP header alone.

const CONFIG_SET_NAME = "voycell-email-tracking";

module.exports = { CONFIG_SET_NAME };
