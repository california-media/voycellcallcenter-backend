const express = require("express");
const router = express.Router();
const { addOrUpdateTask, deleteTask } = require("../controllers/taskController");

router.post("/addEdit", addOrUpdateTask);

router.delete("/delete", deleteTask);

module.exports = router;
