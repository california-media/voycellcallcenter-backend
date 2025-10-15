const express = require("express");
const { getPlans, purchasePlan } = require("../controllers/planController");

const router = express.Router();

// Get all active plans
router.get("/get", getPlans);

// Purchase a plan (protected)
router.post("/purchase", purchasePlan);

module.exports = router;
