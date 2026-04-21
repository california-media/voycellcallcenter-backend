const Stripe = require("stripe");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-04-10",
});

// ─── Products & Prices ────────────────────────────────────────────────────────

/**
 * Create a Stripe Product for a plan
 */
const createStripeProduct = async (planName, description = "") => {
  const product = await stripe.products.create({
    name: planName,
    description: description || planName,
  });
  return product;
};

/**
 * Create a Stripe Price for a product
 * @param {string} productId - Stripe product ID
 * @param {number} amount    - Amount in dollars (will be converted to cents)
 * @param {string} interval  - 'month' | 'year'
 * @param {number} intervalCount - 1 = monthly, 3 = quarterly, 12 = yearly
 */
const createStripePrice = async (productId, amount, interval, intervalCount) => {
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: Math.round(amount * 100), // convert to cents
    currency: "usd",
    recurring: {
      interval,
      interval_count: intervalCount,
    },
  });
  return price;
};

/**
 * Deactivate a Stripe Price
 */
const deactivateStripePrice = async (priceId) => {
  return await stripe.prices.update(priceId, { active: false });
};

/**
 * Archive a Stripe Product
 */
const archiveStripeProduct = async (productId) => {
  return await stripe.products.update(productId, { active: false });
};

// ─── Customers ────────────────────────────────────────────────────────────────

/**
 * Get or create a Stripe customer for a user
 */
const getOrCreateCustomer = async (user) => {
  if (user.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(user.stripeCustomerId);
      if (!existing.deleted) return existing;
    } catch (err) {
      // Customer not found in Stripe - create new
    }
  }
  const customer = await stripe.customers.create({
    email: user.email,
    name: `${user.firstname || ""} ${user.lastname || ""}`.trim(),
    metadata: { userId: user._id.toString() },
  });
  return customer;
};

// ─── Payment Methods ──────────────────────────────────────────────────────────

/**
 * List payment methods for a customer
 */
const listPaymentMethods = async (stripeCustomerId) => {
  const paymentMethods = await stripe.paymentMethods.list({
    customer: stripeCustomerId,
    type: "card",
  });
  return paymentMethods.data;
};

/**
 * Attach a payment method to a customer
 */
const attachPaymentMethod = async (paymentMethodId, stripeCustomerId) => {
  return await stripe.paymentMethods.attach(paymentMethodId, {
    customer: stripeCustomerId,
  });
};

/**
 * Detach a payment method
 */
const detachPaymentMethod = async (paymentMethodId) => {
  return await stripe.paymentMethods.detach(paymentMethodId);
};

/**
 * Set default payment method for a customer
 */
const setDefaultPaymentMethod = async (stripeCustomerId, paymentMethodId) => {
  return await stripe.customers.update(stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
};

/**
 * Retrieve customer (with default payment method)
 */
const retrieveCustomer = async (stripeCustomerId) => {
  return await stripe.customers.retrieve(stripeCustomerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
};

// ─── Subscriptions ────────────────────────────────────────────────────────────

/**
 * Create a Stripe subscription
 */
const createSubscription = async ({
  stripeCustomerId,
  stripePriceId,
  paymentMethodId,
  trialEnd = null,
  couponId = null,
  // Optional: dynamic price for agent-based billing
  priceData = null, // { amount (USD), interval, intervalCount, productName }
}) => {
  let resolvedPriceId = stripePriceId;

  // Create a real Stripe product+price on-the-fly for dynamic (agent-based) pricing
  if (priceData) {
    const product = await stripe.products.create({
      name: priceData.productName || "Subscription",
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(priceData.amount * 100),
      currency: "usd",
      recurring: { interval: priceData.interval, interval_count: priceData.intervalCount },
    });
    resolvedPriceId = price.id;
  }

  const params = {
    customer: stripeCustomerId,
    items: [{ price: resolvedPriceId }],
    default_payment_method: paymentMethodId,
    payment_behavior: "default_incomplete",
    expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
  };

  if (trialEnd) {
    params.trial_end = Math.floor(new Date(trialEnd).getTime() / 1000);
  }
  if (couponId) {
    params.discounts = [{ coupon: couponId }];
  }

  return await stripe.subscriptions.create(params);
};

/**
 * Cancel a subscription (at period end or immediately)
 */
const cancelSubscription = async (stripeSubscriptionId, atPeriodEnd = true) => {
  if (atPeriodEnd) {
    return await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }
  return await stripe.subscriptions.cancel(stripeSubscriptionId);
};

/**
 * Pause a subscription (Stripe native pause)
 */
const pauseSubscription = async (stripeSubscriptionId) => {
  return await stripe.subscriptions.update(stripeSubscriptionId, {
    pause_collection: { behavior: "void" }, // Stop collecting but keep subscription active
  });
};

/**
 * Resume a paused subscription
 */
const resumeSubscription = async (stripeSubscriptionId, newPeriodEnd) => {
  const updates = {
    pause_collection: "", // Clear pause
  };
  if (newPeriodEnd) {
    updates.trial_end = Math.floor(new Date(newPeriodEnd).getTime() / 1000);
  }
  return await stripe.subscriptions.update(stripeSubscriptionId, updates);
};

/**
 * Retrieve a subscription
 */
const retrieveSubscription = async (stripeSubscriptionId) => {
  return await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ["latest_invoice", "customer"],
  });
};

/**
 * Update subscription plan (upgrade/downgrade)
 */
const updateSubscriptionPlan = async (stripeSubscriptionId, newPriceId) => {
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  return await stripe.subscriptions.update(stripeSubscriptionId, {
    items: [
      {
        id: subscription.items.data[0].id,
        price: newPriceId,
      },
    ],
    proration_behavior: "create_prorations",
    expand: ["latest_invoice.lines"],  // expand so we can save the upgrade invoice immediately
  });
};

// ─── Coupons & Promotion Codes ────────────────────────────────────────────────

/**
 * Create a Stripe coupon
 */
const createStripeCoupon = async ({ discountType, discountValue, name, expiresAt }) => {
  const params = { name };
  if (discountType === "percentage") {
    params.percent_off = discountValue;
    params.duration = "once";
  } else {
    params.amount_off = Math.round(discountValue * 100); // to cents
    params.currency = "usd";
    params.duration = "once";
  }
  if (expiresAt) {
    params.redeem_by = Math.floor(new Date(expiresAt).getTime() / 1000);
  }
  return await stripe.coupons.create(params);
};

/**
 * Create a Stripe Promotion Code (the human-readable code used by customers)
 */
const createStripePromotionCode = async (stripeCouponId, code) => {
  return await stripe.promotionCodes.create({
    coupon: stripeCouponId,
    code: code.toUpperCase(),
  });
};

/**
 * Validate a promotion code
 */
const validatePromotionCode = async (code) => {
  const promoCodes = await stripe.promotionCodes.list({
    code: code.toUpperCase(),
    active: true,
    limit: 1,
    expand: ["data.coupon"],
  });
  if (promoCodes.data.length === 0) return null;
  return promoCodes.data[0];
};

/**
 * Archive (delete) a Stripe coupon
 */
const deleteStripeCoupon = async (stripeCouponId) => {
  return await stripe.coupons.del(stripeCouponId);
};

/**
 * Deactivate a Stripe promotion code
 */
const deactivatePromotionCode = async (stripePromotionCodeId) => {
  return await stripe.promotionCodes.update(stripePromotionCodeId, { active: false });
};

// ─── SetupIntent (for saving cards without charging) ─────────────────────────

/**
 * Create a SetupIntent for adding a payment method
 */
const createSetupIntent = async (stripeCustomerId) => {
  return await stripe.setupIntents.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    usage: "off_session",
  });
};

// ─── Invoices ─────────────────────────────────────────────────────────────────

/**
 * List invoices for a customer
 */
const listInvoices = async (stripeCustomerId, limit = 10, startingAfter = null) => {
  const params = { customer: stripeCustomerId, limit };
  if (startingAfter) params.starting_after = startingAfter;
  return await stripe.invoices.list(params);
};

/**
 * Retrieve a single invoice
 */
const retrieveInvoice = async (stripeInvoiceId) => {
  return await stripe.invoices.retrieve(stripeInvoiceId);
};

// ─── Webhooks ─────────────────────────────────────────────────────────────────

/**
 * Construct and verify a Stripe webhook event
 */
const constructWebhookEvent = (payload, sigHeader) => {
  return stripe.webhooks.constructEvent(
    payload,
    sigHeader,
    process.env.STRIPE_WEBHOOK_SECRET
  );
};

module.exports = {
  stripe,
  createStripeProduct,
  createStripePrice,
  deactivateStripePrice,
  archiveStripeProduct,
  getOrCreateCustomer,
  listPaymentMethods,
  attachPaymentMethod,
  detachPaymentMethod,
  setDefaultPaymentMethod,
  retrieveCustomer,
  createSubscription,
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  retrieveSubscription,
  updateSubscriptionPlan,
  createStripeCoupon,
  createStripePromotionCode,
  validatePromotionCode,
  deleteStripeCoupon,
  deactivatePromotionCode,
  createSetupIntent,
  listInvoices,
  retrieveInvoice,
  constructWebhookEvent,
  stripe, // raw Stripe instance for advanced operations
};
