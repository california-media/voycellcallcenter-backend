const { Router } = require("express");
const {
  getMyReferrals,
  getReferralData,
} = require("../controllers/getMyReferralsController");

const router = Router();

router.get("/", getMyReferrals);
router.get("/referral-data", getReferralData);

module.exports = router;
