const express = require("express");
const router = express.Router();
const {
  getAllCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  toggleCouponStatus,
} = require("../../controllers/couponController");

router.get("/", getAllCoupons);
router.post("/", createCoupon);
router.put("/:couponId", updateCoupon);
router.delete("/:couponId", deleteCoupon);
router.put("/:couponId/toggle", toggleCouponStatus);

module.exports = router;
