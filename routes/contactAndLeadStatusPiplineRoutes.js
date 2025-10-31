const express = require("express");
const router = express.Router();
const {
  changeStatus,
  getPipeline,
  getPipelineOverview,
} = require("../controllers/contactAndLeadStatusPiplineController");

router.put("/status", changeStatus);        // Update status (start or continue pipeline)
router.post("/pipeline", getPipeline);          // Get pipeline history for one lead
router.get("/pipeline/overview/all", getPipelineOverview); // Get all leads grouped by stage

module.exports = router;
