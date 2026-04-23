const express = require("express");
const router = express.Router();
const {
  getActivePlans,
  getCurrentSubscription,
  validateCoupon,
  createSetupIntent,
  listPaymentMethods,
  attachPaymentMethod,
  removePaymentMethod,
  setDefaultPaymentMethod,
  subscribeToPlan,
  activateSubscription,
  cancelSubscription,
  upgradePlan,
  previewUpgrade,
  getAgentQuota,
  previewAgentSeats,
  updateAgentSeats,
  getInvoices,
  getRetentionSettings,
  generateRetentionCoupon,
  getMyRetentionCoupon,
  toggleAutoRenewal,
} = require("../controllers/billingController");

// Plans
router.get("/plans", getActivePlans);

// Subscription
router.get("/subscription", getCurrentSubscription);
router.post("/subscribe", subscribeToPlan);
router.post("/subscription/activate", activateSubscription);
router.post("/cancel", cancelSubscription);
router.post("/upgrade", upgradePlan);
router.post("/upgrade/preview", previewUpgrade);

// Agent seats
router.get("/agents/quota", getAgentQuota);
router.post("/agents/preview", previewAgentSeats);
router.post("/agents/update", updateAgentSeats);

// Coupons
router.post("/coupon/validate", validateCoupon);

// Payment methods
router.get("/payment-methods", listPaymentMethods);
router.post("/payment-methods/setup-intent", createSetupIntent);
router.post("/payment-methods/attach", attachPaymentMethod);
router.delete("/payment-methods/:paymentMethodId", removePaymentMethod);
router.put("/payment-methods/set-default", setDefaultPaymentMethod);

// Invoices
router.get("/invoices", getInvoices);

// Retention coupon (cancel flow)
router.get("/retention-settings", getRetentionSettings);
router.get("/retention-coupon/mine", getMyRetentionCoupon);
router.post("/retention-coupon/generate", generateRetentionCoupon);

// Auto-renewal toggle
router.post("/toggle-auto-renewal", toggleAutoRenewal);

module.exports = router;
