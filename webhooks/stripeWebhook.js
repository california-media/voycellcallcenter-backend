const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const {
  processSubscriptionCompletion,
} = require("../utils/subscriptionProcessor");

/**
 * Handle Stripe webhook events
 * This webhook specifically handles checkout.session.completed events to ensure
 * subscription completion logic runs even if the user doesn't reach PaymentSuccess page
 */
const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("Stripe webhook secret not configured");
    return res.status(500).json({
      success: false,
      message: "Webhook secret not configured",
    });
  }

  let event;

  try {
    // Verify the webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log("✅ Webhook signature verified");
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Error handling webhook:", error);
    res.status(500).json({
      success: false,
      message: "Webhook handler error",
      error: error.message,
    });
  }
};

/**
 * Handle checkout.session.completed event
 * This ensures subscription completion logic runs even if user doesn't reach PaymentSuccess page
 */
const handleCheckoutSessionCompleted = async (session) => {
  console.log("🔔 Processing checkout.session.completed webhook:", session.id);

  try {
    // Use the centralized subscription processing function
    const result = await processSubscriptionCompletion(session.id, {
      fromWebhook: true,
    });

    if (result.alreadyProcessed) {
      console.log("⏭️ Session already processed by API endpoint");
    } else {
      console.log("✅ Webhook processing completed successfully");
    }
  } catch (error) {
    console.error("❌ Error in handleCheckoutSessionCompleted:", error);
    throw error; // Re-throw to trigger webhook retry
  }
};

module.exports = {
  handleStripeWebhook,
};
