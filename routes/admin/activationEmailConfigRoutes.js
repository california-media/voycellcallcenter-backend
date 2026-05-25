const express = require("express");
const router  = express.Router();
const {
  getActivationEmailConfig,
  updateActivationEmailConfig,
} = require("../../controllers/admin/activationEmailConfigController");

router.get("/", getActivationEmailConfig);
router.put("/", updateActivationEmailConfig);

module.exports = router;
