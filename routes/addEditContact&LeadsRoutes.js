const { Router } = require("express");
const {
  addEditContactisLeads,
  deleteContactOrLead,
  toggleContactFavorite,
  batchDeleteContacts,
  updateFirstPhoneOrEmail,
} = require("../controllers/addEditContact&LeadsController");
const multer = require("multer");

// Use memory storage (for direct S3 upload)
const storage = multer.memoryStorage();
const upload = multer({ storage });

const router = Router();

// Use .single("contactImage") to handle multipart/form-data uploads
router.post("/", upload.single("contactImage"), addEditContactisLeads);
router.post("/delete", deleteContactOrLead);
router.put("/toggle-favorite", toggleContactFavorite);
router.post("/batch-delete", batchDeleteContacts);
router.put("/update-first-contact", updateFirstPhoneOrEmail);

module.exports = router;
