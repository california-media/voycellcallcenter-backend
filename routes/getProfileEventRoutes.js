const { Router } = require("express");
const { getProfileEvents } = require("../controllers/getProfileEventController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")

const router = Router();


router.post("/",checkAccountStatus, getProfileEvents);

module.exports = router;