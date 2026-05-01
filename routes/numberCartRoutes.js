const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/numberCartController");

router.get("/",                    ctrl.getCart);
router.post("/add",                ctrl.addToCart);
router.delete("/remove/:did_id",   ctrl.removeFromCart);
router.delete("/clear",            ctrl.clearCart);
router.post("/remove-purchased",   ctrl.removePurchasedFromCart);

module.exports = router;
