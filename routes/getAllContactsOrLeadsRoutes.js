const { Router } = require("express");
const {
  getAllContactsOrLeads,
  getSingleContactOrLead,
  getAllContactOrLeadForEvent,
} = require("../controllers/getAllContactsOrLeadsController");
const router = Router();

router.post("/", getAllContactsOrLeads);
router.post("/single", getSingleContactOrLead);
router.get("/ForEvent", getAllContactOrLeadForEvent);

module.exports = router;
