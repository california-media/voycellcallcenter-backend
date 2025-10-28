const { Router } = require("express");
const { getAllContactsOrLeads } = require("../controllers/getAllContactsOrLeadsController");
const router = Router();

router.post("/", getAllContactsOrLeads);

module.exports = router;