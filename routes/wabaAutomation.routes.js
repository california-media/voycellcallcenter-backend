const express = require("express");
const router = express.Router();
const { checkForAuthentication } = require("../middlewares/authentication");
const br = require("../controllers/wabaBasicReplyController");
const fl = require("../controllers/wabaFlowController");

// ── Basic Replies ──────────────────────────────────────
router.get   ("/basic-replies",          checkForAuthentication(), br.list);
router.post  ("/basic-replies",          checkForAuthentication(), br.create);
router.put   ("/basic-replies/:id",      checkForAuthentication(), br.update);
router.delete("/basic-replies/:id",      checkForAuthentication(), br.remove);
router.patch ("/basic-replies/:id/toggle", checkForAuthentication(), br.toggle);

// ── Flows ──────────────────────────────────────────────
router.get   ("/flows",                  checkForAuthentication(), fl.list);
router.get   ("/flows/:id",              checkForAuthentication(), fl.get);
router.post  ("/flows",                  checkForAuthentication(), fl.create);
router.put   ("/flows/:id",              checkForAuthentication(), fl.update);
router.delete("/flows/:id",              checkForAuthentication(), fl.remove);
router.patch ("/flows/:id/toggle",       checkForAuthentication(), fl.toggle);
router.get   ("/flows/:id/submissions",  checkForAuthentication(), fl.submissions);
router.post  ("/flows/:id/trigger",      checkForAuthentication(), fl.manualTrigger);

module.exports = router;
