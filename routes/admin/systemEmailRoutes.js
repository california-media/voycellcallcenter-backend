const express = require("express");
const router = express.Router();
const { getSystemEmailTemplates, updateSystemEmailTemplate } = require("../../controllers/admin/systemEmailController");

router.get("/", getSystemEmailTemplates);
router.put("/:type", updateSystemEmailTemplate);

module.exports = router;
