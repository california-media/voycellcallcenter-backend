const express = require("express");
const router = express.Router();
const {
  addOrUpdateTask,
  deleteTask,
  getTasksForContact,
} = require("../controllers/taskController");

// Get all tasks for a contact with optional sorting
router.get("/getAll", getTasksForContact);

// Add or update a task
router.post("/addEdit", addOrUpdateTask);

// Delete a task
router.delete("/delete", deleteTask);

module.exports = router;
