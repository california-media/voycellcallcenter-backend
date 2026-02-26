const mongoose = require("mongoose");
const Contact = require("../models/contactModel");
const { logActivityToContact } = require("../utils/activityLogger"); // ✅ import activity logger
const Lead = require("../models/leadModel");

/**
 * @route   GET /task/getAll
 * @desc    Get all tasks for a contact with optional sorting
 * @access  Private
 * @query   contact_id (required), sortBy (optional: 'ascending' or 'descending'), filterBy (optional: 'completed', 'incomplete', 'all')
 */
exports.getTasksForContact = async (req, res) => {
  try {
    const { contact_id, sortBy, filterBy, category } = req.query;
    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required.",
      });
    }

    if (!category || (category !== "lead" && category !== "contact")) {
      return res.status(400).json({
        status: "error",
        message: "Valid category is required ('lead' or 'contact').",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(contact_id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid contact_id format.",
      });
    }

    const Model = category === "lead" ? Lead : Contact;
    const userId = req.user._id;

    const contact = await Model.findById(contact_id);
    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Contact not found.",
      });
    }

    // Permission Check
    const isCreator = String(contact.createdBy) === String(userId);
    const assignedArray = Array.isArray(contact.assignedTo) ? contact.assignedTo.map(id => String(id)) : [];
    const isAssignee = assignedArray.includes(String(userId));
    const isAdminOfCreator = async () => {
      const creator = await mongoose.model("User").findById(contact.createdBy).select("createdByWhichCompanyAdmin role");
      return creator && (String(creator._id) === String(userId) || String(creator.createdByWhichCompanyAdmin) === String(userId));
    };

    if (req.user.role === "user" && !isCreator && !isAssignee) {
      return res.status(403).json({ status: "error", message: "Unauthorized access to these tasks." });
    }

    if (req.user.role === "companyAdmin" && !(await isAdminOfCreator())) {
      return res.status(403).json({ status: "error", message: "Unauthorized: Record belongs to another company." });
    }

    let tasks = [...contact.tasks];

    // Filter tasks based on completion status
    if (filterBy === "completed") {
      tasks = tasks.filter((task) => task.taskIsCompleted === true);
    } else if (filterBy === "incomplete") {
      tasks = tasks.filter((task) => task.taskIsCompleted === false);
    }
    // 'all' or no filterBy returns all tasks

    // Sort tasks by creation date or due date
    if (sortBy.toLowerCase() === "ascending") {
      tasks.sort((a, b) => {
        const dateA = a.taskDueDate || a.createdAt;
        const dateB = b.taskDueDate || b.createdAt;
        return new Date(dateA) - new Date(dateB);
      });
    } else if (sortBy.toLowerCase() === "descending") {
      tasks.sort((a, b) => {
        const dateA = a.taskDueDate || a.createdAt;
        const dateB = b.taskDueDate || b.createdAt;
        return new Date(dateB) - new Date(dateA);
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Tasks retrieved successfully.",
      data: {
        tasks,
        totalTasks: tasks.length,
        completedTasks: contact.tasks.filter((t) => t.taskIsCompleted).length,
        incompleteTasks: contact.tasks.filter((t) => !t.taskIsCompleted).length,
      },
    });
  } catch (error) {
    console.error("Error in getTasksForContact:", error);
    return res.status(500).json({
      status: "error",
      message: "Server error. Please try again.",
      error: error.message,
    });
  }
};

/**
 * @route   POST /task/addEdit
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
      category,
    } = req.body;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required.",
      });
    }

    const Model = category === "lead" ? Lead : Contact;
    const userId = req.user._id;

    const contact = await Model.findById(contact_id);
    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Contact not found.",
      });
    }

    // Permission Check
    const isCreator = String(contact.createdBy) === String(userId);
    const assignedArray = Array.isArray(contact.assignedTo) ? contact.assignedTo.map(id => String(id)) : [];
    const isAssignee = assignedArray.includes(String(userId));
    const isAdminOfCreator = async () => {
      const creator = await mongoose.model("User").findById(contact.createdBy).select("createdByWhichCompanyAdmin role");
      return creator && (String(creator._id) === String(userId) || String(creator.createdByWhichCompanyAdmin) === String(userId));
    };

    if (req.user.role === "user" && !isCreator && !isAssignee) {
      return res.status(403).json({ status: "error", message: "Unauthorized access to this contact." });
    }

    if (req.user.role === "companyAdmin" && !(await isAdminOfCreator())) {
      return res.status(403).json({ status: "error", message: "Unauthorized: Record belongs to another company." });
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

    const performerName = `${req.user.firstname} ${req.user.lastname}`;

    // Log activity
    if (isUpdating) {
      await logActivityToContact(category, contact_id, {
        action: "task_updated",
        type: "task",
        title: "Note Updated",
        description: `${taskDescription || "Note details updated"} (by ${performerName})`,
      });
    } else {
      await logActivityToContact(category, contact_id, {
        action: "note_created",
        type: "task",
        title: "Note Created",
        description: `${taskDescription || "New note added"} (by ${performerName})`,
      });
    }

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
  const { contact_id, task_id, category } = req.body;

  // Validate contactId
  if (!mongoose.Types.ObjectId.isValid(contact_id)) {
    return res.status(400).json({
      status: "error",
      message: "Invalid contact ID",
    });
  }

  try {
    const Model = category === "lead" ? Lead : Contact;
    const userId = req.user._id;

    // 1️⃣ Find contact first to get the task description before deleting
    const contact = await Model.findOne({
      _id: contact_id,
      "tasks.task_id": task_id,
    });

    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Task not found in this contact",
      });
    }

    // Permission Check
    const isCreator = String(contact.createdBy) === String(userId);
    const assignedArray = Array.isArray(contact.assignedTo) ? contact.assignedTo.map(id => String(id)) : [];
    const isAssignee = assignedArray.includes(String(userId));
    const isAdminOfCreator = async () => {
      const creator = await mongoose.model("User").findById(contact.createdBy).select("createdByWhichCompanyAdmin role");
      return creator && (String(creator._id) === String(userId) || String(creator.createdByWhichCompanyAdmin) === String(userId));
    };

    if (req.user.role === "user" && !isCreator && !isAssignee) {
      return res.status(403).json({ status: "error", message: "Unauthorized access to this contact." });
    }

    if (req.user.role === "companyAdmin" && !(await isAdminOfCreator())) {
      return res.status(403).json({ status: "error", message: "Unauthorized: Record belongs to another company." });
    }

    // 2️⃣ Extract the task description
    const task = contact.tasks.find((t) => t.task_id.toString() === task_id);
    const taskDescription = task
      ? task.taskDescription || "No description"
      : "No description";

    // 3️⃣ Delete the task
    await Model.updateOne(
      { _id: contact_id },
      { $pull: { tasks: { task_id } } }
    );

    // 4️⃣ Log the activity
    await logActivityToContact(category, contact_id, {
      action: "task_deleted",
      type: "task",
      title: "Note Deleted",
      description: `${taskDescription}`,
    });

    return res.status(200).json({
      status: "success",
      message: "Note Deleted",
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
