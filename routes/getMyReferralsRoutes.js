const { Router } = require("express");
const {
  getMyReferrals,
  getReferralData,
} = require("../controllers/getMyReferralsController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")

const router = Router();

router.get("/", checkAccountStatus, getMyReferrals);
router.get("/referral-data", checkAccountStatus, getReferralData);

module.exports = router;
