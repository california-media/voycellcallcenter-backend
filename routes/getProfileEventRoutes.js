const { Router } = require("express");
const { getProfileEvents } = require("../controllers/getProfileEventController");

const router = Router();


router.post("/", getProfileEvents);

module.exports = router;