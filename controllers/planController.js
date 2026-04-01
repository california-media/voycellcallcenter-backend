// This controller handles public/companyAdmin plan endpoints.
// Superadmin plan management is in controllers/admin/planManagementController.js
const Plan = require("../models/Plan");

const getPlans = async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true, isDeleted: false }).sort({ order: 1 });
    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch plans" });
  }
};

const purchasePlan = async (req, res) => {
  // Handled by /billing/subscribe
  res.status(301).json({ success: false, message: "Use /billing/subscribe instead" });
};

module.exports = { getPlans, purchasePlan };
