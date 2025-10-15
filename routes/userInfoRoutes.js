const express = require("express");
const router = express.Router();
const {
  getDefaultOptions,
  submitUserOnboarding,
  getUserOnboardingData
} = require("../controllers/userInfoController");

// POST register

// GET default onboarding options
router.get("/default-options", getDefaultOptions);

// POST onboarding answers
router.post("/onboarding-submit", submitUserOnboarding);

// GET user's onboarding data
router.get("/user-onboarding-data", getUserOnboardingData);

module.exports = router;
