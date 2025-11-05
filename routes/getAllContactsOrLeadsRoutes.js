const { Router } = require("express");
const {
  getAllContactsOrLeads,
  getSingleContactOrLead,
} = require("../controllers/getAllContactsOrLeadsController");
const router = Router();

router.post("/", getAllContactsOrLeads);
router.post("/single", getSingleContactOrLead);

module.exports = router;
