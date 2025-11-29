const express = require("express");
const router = express.Router();

const {
  getAllHelpSupportTickets,
  getHelpSupportTicketById,
  replyToHelpSupportTicket,
  deleteHelpSupportTicket,
  closeHelpSupportTicket,
  getHelpSupportStats,
} = require("../../controllers/admin/adminHelpSupportController");

// GET /admin/help-support/stats - Get dashboard statistics
router.get("/stats", getHelpSupportStats);

// GET /admin/help-support - Get all help support tickets with pagination and filters
router.get("/", getAllHelpSupportTickets);

// GET /admin/help-support/:id - Get single help support ticket by ID
router.get("/:id", getHelpSupportTicketById);

// POST /admin/help-support/:id/reply - Reply to a help support ticket
router.post("/:id/reply", replyToHelpSupportTicket);

// POST /admin/help-support/:id/close - Close a help support ticket
router.post("/:id/close", closeHelpSupportTicket);

// DELETE /admin/help-support/:id - Delete a help support ticket
router.delete("/:id", deleteHelpSupportTicket);

module.exports = router;
