const express = require("express");
const router = express.Router();
const {
  adminRegisterUser,
  getAllUsersByCompanyAdmin,
  editAgent,
  deleteAgent,
} = require("../../controllers/admin/adminUserController");

router.post("/register", adminRegisterUser);

router.get("/getAgent", getAllUsersByCompanyAdmin);

router.put("/:id", editAgent);

router.delete("/:id", deleteAgent);

module.exports = router;
