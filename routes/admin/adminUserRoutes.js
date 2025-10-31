const express = require("express");
const router = express.Router();
const {
    adminRegisterUser,
    getAllUsersByCompanyAdmin
    // verifyUser,
} = require("../../controllers/admin/adminUserController");


router.post("/register", adminRegisterUser);

router.get("/getAgent", getAllUsersByCompanyAdmin);

module.exports = router;