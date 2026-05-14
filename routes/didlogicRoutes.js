const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/didlogicController");

router.get("/numbers/calling-numbers", ctrl.getCallingNumbers);
router.patch("/numbers/default-caller", ctrl.setDefaultCallerDID);
router.get("/numbers/countries", ctrl.getAvailableCountries);
router.get("/numbers/browse", ctrl.browseNumbers);
router.get("/numbers/kyc-requirements", ctrl.getKYCInfo);
router.post("/numbers/buy", ctrl.buyNumber);
router.get("/numbers/my", ctrl.getMyNumbers);
router.get("/numbers/agents", ctrl.getMyAgents);
router.put("/numbers/my/:id/assign", ctrl.assignNumberToAgent);
router.delete("/numbers/my/:id", ctrl.releaseNumber);
router.get("/call-records", ctrl.getCallRecords);
router.get("/transactions", ctrl.getDIDTransactions);

module.exports = router;
