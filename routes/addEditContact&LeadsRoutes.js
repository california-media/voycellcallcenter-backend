const { Router } = require("express");
const {
  addEditContactisLeads,
  deleteContactOrLead,
  toggleContactFavorite,
  batchDeleteContacts,
  updateFirstPhoneOrEmail,
  updateAttachments,
  assignContactOrLead,
} = require("../controllers/addEditContact&LeadsController");
const multer = require("multer");
const checkAccountStatus = require("../middlewares/checkAccountStatus")

// Use memory storage (for direct S3 upload)
const storage = multer.memoryStorage();
const upload = multer({ storage });

const router = Router();

// Use .single("contactImage") to handle multipart/form-data uploads
router.post("/", upload.single("contactImage"), checkAccountStatus, addEditContactisLeads);
router.post("/delete", checkAccountStatus, deleteContactOrLead);
router.put("/toggle-favorite", checkAccountStatus, toggleContactFavorite);
router.post("/batch-delete", checkAccountStatus, batchDeleteContacts);
router.put("/update-first-contact", checkAccountStatus, updateFirstPhoneOrEmail);
router.post("/assignedContactLeadToAgent", checkAccountStatus, assignContactOrLead);
router.put(
  "/update-attachments",
  upload.array("attachments", 10),
  checkAccountStatus,
  updateAttachments
);

module.exports = router;
