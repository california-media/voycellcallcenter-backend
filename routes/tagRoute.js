const express = require("express");
const router = express.Router();
const { updateContactTags, addTag, getTags, getTagWithContact, editTag, deleteTag } = require("../controllers/tagController");

router.post("/assignedToContact", updateContactTags);

router.post("/addTagToUser", addTag);

router.get("/getTagsOfUser", getTags);

router.get("/getTagWithContact", getTagWithContact);

router.put("/editTagOfUser", editTag);

router.delete("/deleteTagOfUser", deleteTag);

module.exports = router;
