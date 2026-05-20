// voycellcallcenter-backend/routes/powerDialerRoutes.js
const express = require("express");
const router = express.Router();
const checkRole = require("../middlewares/roleCheck");

const { createList, getLists, deleteList, assignList, resetList, getListContacts } = require("../controllers/powerDialerListController");
const { createCampaign, getCampaigns, updateCampaign, deleteCampaign, updateCampaignStatus } = require("../controllers/powerDialerCampaignController");
const { startSession, getActiveSession, pauseSession, resumeSession, stopSession, nextContact, getLiveStats } = require("../controllers/powerDialerSessionController");

// Lists
router.post("/lists", createList);
router.get("/lists", getLists);
router.delete("/lists/:id", deleteList);
router.post("/lists/:id/assign", checkRole(["companyAdmin"]), assignList);
router.get("/lists/:id/contacts", getListContacts);
router.put("/lists/:id/reset", checkRole(["companyAdmin"]), resetList);

// Campaigns
router.post("/campaigns", createCampaign);
router.get("/campaigns", getCampaigns);
router.put("/campaigns/:id", updateCampaign);
router.delete("/campaigns/:id", deleteCampaign);
router.put("/campaigns/:id/status", updateCampaignStatus);

// Sessions — IMPORTANT: /sessions/active must come before /sessions/:id/...
router.get("/sessions/active", getActiveSession);
router.post("/sessions", startSession);
router.put("/sessions/:id/pause", pauseSession);
router.put("/sessions/:id/resume", resumeSession);
router.put("/sessions/:id/stop", stopSession);
router.post("/sessions/:id/next", nextContact);

// Live monitoring
router.get("/live", getLiveStats);

module.exports = router;
