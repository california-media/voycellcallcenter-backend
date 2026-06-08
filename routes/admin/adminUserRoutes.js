const express = require("express");
const router = express.Router();
const {
  adminRegisterUser,
  getAllUsersByCompanyAdmin,
  editAgent,
  deleteAgent,
  assignAgentCallerNumbers,
  toggleAgentCallerNumber,
  reassignExtension,
  toggleExtensionEnabled,
} = require("../../controllers/admin/adminUserController");

router.post("/register", adminRegisterUser);

router.get("/getAgent", getAllUsersByCompanyAdmin);

router.put("/reassign-extension", reassignExtension);

router.patch("/extension/:extensionNumber/toggle", toggleExtensionEnabled);

router.put("/:id", editAgent);

router.put("/:id/caller-numbers", assignAgentCallerNumbers);

router.patch("/:id/caller-number", toggleAgentCallerNumber);

router.delete("/:id", deleteAgent);

module.exports = router;
