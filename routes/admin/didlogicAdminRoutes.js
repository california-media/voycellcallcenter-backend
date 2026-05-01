const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/admin/didlogicAdminController");

// Live DIDLogic account balance
router.get("/balance", ctrl.getAccountBalance);

// API settings + margins
router.get("/settings", ctrl.getSettings);
router.put("/settings", ctrl.updateSettings);

// Number management
router.post("/numbers/sync", ctrl.syncNumbers);
router.get("/numbers", ctrl.getAllNumbers);
router.put("/numbers/:id", ctrl.updateNumberMargin);

// Call records (full account view)
router.get("/call-records", ctrl.getCallRecords);

module.exports = router;
