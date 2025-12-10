const { Router } = require("express");
const { deleteTemplate } = require("../controllers/deleteTemplateController");
const checkAccountStatus = require("../middlewares/checkAccountStatus");
const router = Router();


router.delete("/", checkAccountStatus, deleteTemplate);


module.exports = router;
