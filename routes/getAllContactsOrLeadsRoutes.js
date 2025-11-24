const { Router } = require("express");
const {
  getAllContactsOrLeads,
  getSingleContactOrLead,
  getAllContactOrLeadForEvent,
  getAllActivities
} = require("../controllers/getAllContactsOrLeadsController");
const router = Router();

router.post("/", getAllContactsOrLeads);
router.post("/single", getSingleContactOrLead);
router.get("/ForEvent", getAllContactOrLeadForEvent);
router.get("/activities", getAllActivities);

module.exports = router;
