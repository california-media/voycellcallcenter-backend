const { Router } = require("express");
const {
    addEditTemplate
} = require("../controllers/addEditTempleteController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")
const router = Router();
router.post("/", checkAccountStatus, addEditTemplate);

module.exports = router;
