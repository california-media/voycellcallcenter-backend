const stripe = require("stripe");

// Initialize Stripe with secret key from environment variables
const stripeConfig = {
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  secretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
};

// Initialize Stripe with secret key
const stripeInstance = stripe(stripeConfig.secretKey);

module.exports = {
  stripe: stripeInstance,
  stripeConfig,
};
