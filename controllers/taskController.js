const mongoose = require("mongoose");
const Contact = require("../models/contactModel");
const { logActivityToContact } = require("../utils/activityLogger"); // ✅ import activity logger

/**
 * @route   POST /contacts/task
 * @desc    Add or update a task for a contact
 * @access  Private
 */
exports.addOrUpdateTask = async (req, res) => {
  try {
    const {
      contact_id, // required
      task_id, // optional — if provided, update; else, add new
      taskDescription,
      taskDueDate,
      taskDueTime,
      taskIsCompleted,
    } = req.body;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required.",
      });
    }

    const contact = await Contact.findById(contact_id);
    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Contact not found.",
      });
    }

    // Determine if updating existing task
    const isUpdating = !!task_id;

    // ---------- Handle Task ----------
    const taskProvided =
      !!taskDescription ||
      !!taskDueDate ||
      !!taskDueTime ||
      typeof taskIsCompleted === "boolean" ||
      taskIsCompleted === "true" ||
      taskIsCompleted === "false";

    if (!taskProvided) {
      return res.status(400).json({
        status: "error",
        message: "No task fields provided.",
      });
    }

    // --- Update existing task ---
    if (isUpdating) {
      const existingTask = contact.tasks.find(
        (t) => t.task_id.toString() === task_id
      );

      if (!existingTask) {
        return res.status(404).json({
          status: "error",
          message: "Task not found for this contact.",
        });
      }

      if (typeof taskDescription !== "undefined")
        existingTask.taskDescription = taskDescription || "";
      if (taskDueDate) existingTask.taskDueDate = taskDueDate;
      if (taskDueTime) existingTask.taskDueTime = taskDueTime;
      if (typeof taskIsCompleted !== "undefined") {
        existingTask.taskIsCompleted =
          taskIsCompleted === true || taskIsCompleted === "true";
      }

      existingTask.updatedAt = new Date();
    }

    // --- Add new task ---
    else {
      // Prevent creating completed task initially
      if (taskIsCompleted === true || taskIsCompleted === "true") {
        return res.status(400).json({
          status: "error",
          message: "Task cannot be created as completed.",
        });
      }

      const newTask = {
        task_id: new mongoose.Types.ObjectId(),
        taskDescription: taskDescription || "",
        taskDueDate: taskDueDate || null,
        taskDueTime: taskDueTime || null,
        taskIsCompleted: false,
        createdAt: new Date(),
      };

      contact.tasks.push(newTask);
    }

    await contact.save();

    return res.status(200).json({
      status: "success",
      message: isUpdating
        ? "Task updated successfully."
        : "Task added successfully.",
      data: contact.tasks,
    });
  } catch (error) {
    console.error("Error in addOrUpdateTask:", error);
    return res.status(500).json({
      status: "error",
      message: "Server error. Please try again.",
      error: error.message,
    });
  }
};



exports.deleteTask = async (req, res) => {
  const { contact_id, task_id } = req.body;

  // Validate contactId
  if (!mongoose.Types.ObjectId.isValid(contact_id)) {
    return res.status(400).json({
      status: "error",
      message: "Invalid contact ID",
    });
  }

  try {
    // 1️⃣ Find contact first to get the task description before deleting
    const contact = await Contact.findOne({
      _id: contact_id,
      createdBy: req.user._id,
      "tasks.task_id": task_id,
    });

    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Task not found in this contact or unauthorized access",
      });
    }

    // 2️⃣ Extract the task description
    const task = contact.tasks.find(t => t.task_id === task_id);
    const taskDescription = task ? task.description || "No description" : "No description";

    // 3️⃣ Delete the task
    await Contact.updateOne(
      { _id: contact_id },
      { $pull: { tasks: { task_id } } }
    );

    // 4️⃣ Log the activity
    await logActivityToContact(contact_id, {
      action: "task_deleted",
      type: "task",
      title: "Task Deleted",
      description: `${taskDescription}`,
    });

    return res.status(200).json({
      status: "success",
      message: "Task Deleted",
      data: { task_id },
    });

  } catch (error) {
    console.error("Delete Task Error:", error);
    return res.status(500).json({
      status: "error",
      message: "An error occurred while deleting the task",
    });
  }
};