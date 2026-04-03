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
  getAgentQuota,
  previewAgentSeats,
  updateAgentSeats,
  getInvoices,
} = require("../controllers/billingController");

// Plans
router.get("/plans", getActivePlans);

// Subscription
router.get("/subscription", getCurrentSubscription);
router.post("/subscribe", subscribeToPlan);
router.post("/subscription/activate", activateSubscription);
router.post("/cancel", cancelSubscription);
router.post("/upgrade", upgradePlan);

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

module.exports = router;
