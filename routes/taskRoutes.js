const express = require("express");
const router = express.Router();
const {
  addOrUpdateTask,
  deleteTask,
  getTasksForContact,
} = require("../controllers/taskController");
const checkAccountStatus = require("../middlewares/checkAccountStatus")


// Get all tasks for a contact with optional sorting
router.get("/getAll",checkAccountStatus, getTasksForContact);

// Add or update a task
router.post("/addEdit",checkAccountStatus, addOrUpdateTask);

// Delete a task
router.delete("/delete",checkAccountStatus, deleteTask);

module.exports = router;
