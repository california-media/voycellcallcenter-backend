const express = require("express");
const router = express.Router();
const {
  changeStatus,
  getPipeline,
  getPipelineOverview,
} = require("../controllers/contactAndLeadStatusPiplineController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")


router.put("/status", checkAccountStatus, changeStatus);        // Update status (start or continue pipeline)
router.post("/pipeline", checkAccountStatus, getPipeline);          // Get pipeline history for one lead
router.get("/pipeline/overview/all", checkAccountStatus, getPipelineOverview); // Get all leads grouped by stage

module.exports = router;
