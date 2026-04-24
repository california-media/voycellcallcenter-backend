const express = require("express");
const router  = express.Router();
const { checkForAuthentication } = require("../middlewares/authentication");
const { getCredits, purchaseCredits, updateAutoRecharge } = require("../controllers/creditsController");

router.get  ("/",              checkForAuthentication(), getCredits);
router.post ("/purchase",      checkForAuthentication(), purchaseCredits);
router.put  ("/auto-recharge", checkForAuthentication(), updateAutoRecharge);

module.exports = router;
