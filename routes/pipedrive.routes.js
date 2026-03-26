const express = require("express");
const router  = express.Router();
const {
  connectPipedrive,
  pipedriveCallback,
  disconnectPipedrive,
  testPipedriveConnection,
} = require("../controllers/pipedrive.controller");
const { checkForAuthentication } = require("../middlewares/authentication");

router.post("/connect",          checkForAuthentication(), connectPipedrive);
router.get("/callback",          pipedriveCallback);
router.post("/disconnect",       checkForAuthentication(), disconnectPipedrive);
router.get("/test-connection",   checkForAuthentication(), testPipedriveConnection);

module.exports = router;