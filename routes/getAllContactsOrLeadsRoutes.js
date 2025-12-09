const { Router } = require("express");
const {
  getAllContactsOrLeads,
  getSingleContactOrLead,
  getAllContactOrLeadForEvent,
  getAllActivities,
  searchByPhone,
} = require("../controllers/getAllContactsOrLeadsController");
const router = Router();
const checkAccountStatus = require("../middlewares/checkAccountStatus")


router.post("/", checkAccountStatus, getAllContactsOrLeads);
router.post("/single", checkAccountStatus, getSingleContactOrLead);
router.get("/ForEvent", checkAccountStatus, getAllContactOrLeadForEvent);
router.get("/activities", checkAccountStatus, getAllActivities);
router.get("/searchByPhone", checkAccountStatus, searchByPhone);

module.exports = router;
