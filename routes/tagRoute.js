const express = require("express");
const router = express.Router();
const { updateContactTags, updateMultipleContactTags, addTag, getTags, getTagWithContact, editTag, deleteTag } = require("../controllers/tagController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")

router.post("/assignedToContact", checkAccountStatus, updateContactTags);

router.post("/assignedToMultipleContacts", checkAccountStatus, updateMultipleContactTags);

router.post("/addTagToUser", checkAccountStatus, addTag);

router.get("/getTagsOfUser", checkAccountStatus, getTags);

router.get("/getTagWithContact", checkAccountStatus, getTagWithContact);

router.put("/editTagOfUser", checkAccountStatus, editTag);

router.delete("/deleteTagOfUser", checkAccountStatus, deleteTag);

module.exports = router;
