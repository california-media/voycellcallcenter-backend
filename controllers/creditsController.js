const User          = require("../models/userModel");
const Invoice       = require("../models/Invoice");
const stripeService = require("../services/stripeService");

// ── Auto-recharge helper ──────────────────────────────────────────────────────
// Charges the user's default Stripe card if autoRecharge is enabled and
// creditBalance has dropped below the configured threshold.
const autoRechargeIfNeeded = async (userId) => {
  const user = await User.findById(userId)
    .select("creditBalance autoRecharge stripeCustomerId email firstname lastname");
  if (!user) return;

  const { creditBalance, autoRecharge } = user;
  if (!autoRecharge?.enabled) return;
  if ((creditBalance || 0) >= autoRecharge.threshold) return;
  if (!user.stripeCustomerId) return;

  const customer = await stripeService.retrieveCustomer(user.stripeCustomerId);
  const defaultPm = customer?.invoice_settings?.default_payment_method;
  if (!defaultPm) return;

  const paymentMethodId = typeof defaultPm === "string" ? defaultPm : defaultPm.id;
  const amount      = autoRecharge.amount;
  const amountCents = Math.round(amount * 100);

  const stripeInvoice = await stripeService.stripe.invoices.create({
    customer:                       customer.id,
    auto_advance:                   false,
    pending_invoice_items_behavior: "exclude",
  });

  await stripeService.stripe.invoiceItems.create({
    customer:    customer.id,
    invoice:     stripeInvoice.id,
    amount:      amountCents,
    currency:    "usd",
    description: `Auto-recharge — $${amount}`,
  });

  const finalizedInvoice = await stripeService.stripe.invoices.finalizeInvoice(stripeInvoice.id);

  let paidInvoice = finalizedInvoice;
  if (finalizedInvoice.status !== "paid") {
    paidInvoice = await stripeService.stripe.invoices.pay(finalizedInvoice.id, {
      payment_method: paymentMethodId,
    });
  }

  if (paidInvoice.status !== "paid") return;

  await User.findByIdAndUpdate(userId, { $inc: { creditBalance: amount } });

  const chargedCents = paidInvoice.amount_paid || paidInvoice.total || amountCents;
  await Invoice.create({
    userId,
    stripeInvoiceId:  paidInvoice.id,
    stripeChargeId:   paidInvoice.charge || null,
    invoiceNumber:    paidInvoice.number || null,
    amount:           chargedCents,
    amountPaid:       chargedCents,
    planAmount:       chargedCents,
    currency:         paidInvoice.currency || "usd",
    status:           "paid",
    hostedInvoiceUrl: paidInvoice.hosted_invoice_url || null,
    invoicePdf:       paidInvoice.invoice_pdf || null,
    stripeCreatedAt:  new Date(),
    couponCode:       "AUTO_RECHARGE",
  });
};

// ── GET /billing/credits ──────────────────────────────────────────────────────
const getCredits = async (req, res) => {
  try {
    // Trigger auto-recharge if needed, then return the latest balance
    await autoRechargeIfNeeded(req.user._id).catch(err =>
      console.error("autoRecharge error:", err.message)
    );

    const user = await User.findById(req.user._id)
      .select("creditBalance autoRecharge")
      .lean();
    res.json({
      success: true,
      creditBalance: user.creditBalance || 0,
      autoRecharge: user.autoRecharge || { enabled: false, threshold: 5, amount: 100 },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /billing/credits/purchase ───────────────────────────────────────────
// Charges the user's saved card via Stripe, then adds credits to their balance.
// Body: { amount: number (USD), paymentMethodId: string }
const purchaseCredits = async (req, res) => {
  try {
    const { amount, paymentMethodId } = req.body;
    if (!amount || amount <= 0)
      return res.status(400).json({ success: false, message: "amount must be > 0" });
    if (!paymentMethodId)
      return res.status(400).json({ success: false, message: "paymentMethodId is required" });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Ensure Stripe customer exists
    const customer = await stripeService.getOrCreateCustomer(user);
    const amountCents = Math.round(amount * 100);

    // Use a proper Stripe Invoice so the user sees the same
    // branded invoice page (with Download Invoice + Download Receipt) as plan purchases.

    // 1. Create the invoice first
    const stripeInvoice = await stripeService.stripe.invoices.create({
      customer:                       customer.id,
      auto_advance:                   false,
      pending_invoice_items_behavior: "exclude", // don't pull in subscription pending items
    });

    // 2. Attach the line item directly to this invoice using the invoice id
    await stripeService.stripe.invoiceItems.create({
      customer:    customer.id,
      invoice:     stripeInvoice.id,  // ← pin to this invoice, not floating pending
      amount:      amountCents,
      currency:    "usd",
      description: `Credit top-up — $${amount}`,
    });

    // 3. Finalize
    const finalizedInvoice = await stripeService.stripe.invoices.finalizeInvoice(stripeInvoice.id);

    // 3. Pay the invoice — skip if Stripe already auto-collected on finalize
    let paidInvoice = finalizedInvoice;
    if (finalizedInvoice.status !== "paid") {
      paidInvoice = await stripeService.stripe.invoices.pay(finalizedInvoice.id, {
        payment_method: paymentMethodId,
      });
    }

    if (paidInvoice.status !== "paid") {
      return res.status(402).json({ success: false, message: "Payment not completed. Please check your card details." });
    }

    // 4. Add credits and create our Invoice record
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { creditBalance: amount } },
      { new: true }
    ).select("creditBalance");

    // Use amounts from Stripe's response so DB always matches what was actually charged
    const chargedCents = paidInvoice.amount_paid || paidInvoice.total || amountCents;

    await Invoice.create({
      userId:               req.user._id,
      stripeInvoiceId:      paidInvoice.id,
      stripeChargeId:       paidInvoice.charge || null,
      invoiceNumber:        paidInvoice.number || null,
      amount:               chargedCents,
      amountPaid:           chargedCents,
      planAmount:           chargedCents,
      currency:             paidInvoice.currency || "usd",
      status:               "paid",
      hostedInvoiceUrl:     paidInvoice.hosted_invoice_url || null,
      invoicePdf:           paidInvoice.invoice_pdf || null,
      stripeCreatedAt:      new Date(),
      couponCode:           "CREDIT_TOPUP",
    });

    res.json({
      success: true,
      creditBalance: updated.creditBalance,
      message: `$${amount} added to your credit balance.`,
    });
  } catch (err) {
    console.error("purchaseCredits error:", err);
    const msg = err?.raw?.message || err.message || "Payment failed";
    res.status(500).json({ success: false, message: msg });
  }
};

// ── PUT /billing/credits/auto-recharge ───────────────────────────────────────
// Body: { enabled, threshold, amount }
const updateAutoRecharge = async (req, res) => {
  try {
    const { enabled, threshold, amount } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      "autoRecharge.enabled":   !!enabled,
      "autoRecharge.threshold": threshold ?? 5,
      "autoRecharge.amount":    amount    ?? 100,
    });
    res.json({ success: true, message: "Auto-recharge settings saved." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getCredits, purchaseCredits, updateAutoRecharge, autoRechargeIfNeeded };
