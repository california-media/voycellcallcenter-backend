const express = require("express");
const router = express.Router();
const {
deleteUserPermanently
} = require("../controllers/deleteAllTheDataBySuperAdminController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")
router.delete("/", checkAccountStatus, deleteUserPermanently); // Delete all data associated with a user by superadmin

module.exports = router;
