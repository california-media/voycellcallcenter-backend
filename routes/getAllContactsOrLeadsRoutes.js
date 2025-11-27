const { Router } = require("express");
const {
  getAllContactsOrLeads,
  getSingleContactOrLead,
  getAllContactOrLeadForEvent,
  getAllActivities
} = require("../controllers/getAllContactsOrLeadsController");
const router = Router();
const checkAccountStatus = require("../middlewares/checkAccountStatus")


router.post("/", checkAccountStatus,getAllContactsOrLeads);
router.post("/single",checkAccountStatus, getSingleContactOrLead);
router.get("/ForEvent",checkAccountStatus, getAllContactOrLeadForEvent);
router.get("/activities",checkAccountStatus, getAllActivities);

module.exports = router;
