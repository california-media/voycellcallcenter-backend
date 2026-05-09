/**
 * sesWebhookController.js
 *
 * Handles inbound SNS notifications for SES email tracking events.
 *
 * SNS sends two message types to our endpoint:
 *   1. SubscriptionConfirmation — we auto-confirm by fetching the SubscribeURL
 *   2. Notification             — contains the SES event JSON; we save it and
 *                                 increment the matching counter on EmailLog
 */

const axios         = require("axios");
const SesEmailEvent = require("../models/SesEmailEvent");
const SesMessageLog = require("../models/SesMessageLog");
const EmailLog      = require("../models/EmailLog");

// Map SES notificationType → EmailLog stats field
const EVENT_FIELD_MAP = {
  Send:             "sends",
  Delivery:         "deliveries",
  Open:             "opens",
  Click:            "clicks",
  Bounce:           "bounces",
  Complaint:        "complaints",
  Reject:           "rejections",
  DeliveryDelay:    null,   // informational only — no counter
  RenderingFailure: null,
  Subscription:     null,
};

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handleSnsEvent = async (req, res) => {
  // SNS sends Content-Type: text/plain, body is JSON string
  let payload;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (_) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const msgType = payload?.Type || req.headers["x-amz-sns-message-type"];

  // ── 1. Auto-confirm new SNS subscriptions ─────────────────────────────────
  if (msgType === "SubscriptionConfirmation") {
    try {
      await axios.get(payload.SubscribeURL);
      console.log("[SesWebhook] ✅ SNS subscription confirmed.");
    } catch (err) {
      console.error("[SesWebhook] Failed to confirm SNS subscription:", err.message);
    }
    return res.sendStatus(200);
  }

  // ── 2. Process SES event notification ────────────────────────────────────
  if (msgType === "Notification") {
    // The actual SES event is JSON-encoded inside payload.Message
    let sesEvent;
    try {
      sesEvent = typeof payload.Message === "string"
        ? JSON.parse(payload.Message)
        : payload.Message;
    } catch (_) {
      console.error("[SesWebhook] Could not parse SES event from Message field.");
      return res.sendStatus(200); // always 200 so SNS doesn't retry
    }

    await processSesEvent(sesEvent);
    return res.sendStatus(200);
  }

  // Unknown message type — return 200 so SNS does not retry
  return res.sendStatus(200);
};

// ── Core event processing ─────────────────────────────────────────────────────

async function processSesEvent(sesEvent) {
  try {
    // SES can send the event type as either notificationType or eventType
    const notificationType = sesEvent?.notificationType || sesEvent?.eventType;
    const mail             = sesEvent?.mail || {};
    const sesMessageId     = mail.messageId;

    if (!sesMessageId) {
      console.warn("[SesWebhook] No messageId in SES event — skipping.");
      return;
    }

    // Derive recipient email (first address in destination array)
    const recipientEmail = (mail.destination || [])[0] || "";

    // Resolve the actual event timestamp — each event type carries its own timestamp.
    // mail.timestamp is the send time; using it for Open/Click would show wrong timings.
    const eventTimestamp =
      sesEvent.delivery?.timestamp ||
      sesEvent.open?.timestamp     ||
      sesEvent.click?.timestamp    ||
      sesEvent.bounce?.timestamp   ||
      sesEvent.complaint?.timestamp ||
      mail.timestamp               ||
      Date.now();

    // Build the event document
    const eventDoc = {
      sesMessageId,
      recipientEmail,
      eventType:  notificationType || "Unknown",
      timestamp:  new Date(eventTimestamp),
      raw:        sesEvent,
    };

    // Event-specific fields
    if (notificationType === "Bounce" && sesEvent.bounce) {
      eventDoc.bounceType    = sesEvent.bounce.bounceType;
      eventDoc.bounceSubType = sesEvent.bounce.bounceSubType;
    }

    if (notificationType === "Click" && sesEvent.click) {
      eventDoc.clickUrl  = sesEvent.click.link;
      eventDoc.userAgent = sesEvent.click.userAgent;
      eventDoc.ipAddress = sesEvent.click.ipAddress;
    }

    if (notificationType === "Open" && sesEvent.open) {
      eventDoc.userAgent = sesEvent.open.userAgent;
      eventDoc.ipAddress = sesEvent.open.ipAddress;
    }

    // Look up the campaign this message belongs to.
    // The SES "Send" event fires within milliseconds of SES accepting the email —
    // sometimes BEFORE our SesMessageLog.insertMany has finished writing to MongoDB.
    // We retry once after 3 seconds to eliminate this race condition.
    let msgLog = await SesMessageLog.findOne({ sesMessageId }).lean();
    if (!msgLog) {
      await new Promise((r) => setTimeout(r, 3000));
      msgLog = await SesMessageLog.findOne({ sesMessageId }).lean();
    }

    if (msgLog?.emailLogId) {
      eventDoc.emailLogId = msgLog.emailLogId;
      eventDoc.batchJobId = msgLog.batchJobId || null;
    } else if (msgLog?.batchJobId) {
      eventDoc.batchJobId = msgLog.batchJobId;
    }

    // Save the raw event
    await SesEmailEvent.create(eventDoc);

    // Increment the matching counter on EmailLog (if we know which log this belongs to)
    const statsField = EVENT_FIELD_MAP[notificationType];
    if (statsField && msgLog?.emailLogId) {
      await EmailLog.findByIdAndUpdate(
        msgLog.emailLogId,
        { $inc: { [`stats.${statsField}`]: 1 } }
      );
    }

    console.log(`[SesWebhook] ${notificationType} recorded for ${recipientEmail} (msg: ${sesMessageId})`);
  } catch (err) {
    // Log but never throw — we must always return 200 to SNS
    console.error("[SesWebhook] Error processing event:", err.message);
  }
}
