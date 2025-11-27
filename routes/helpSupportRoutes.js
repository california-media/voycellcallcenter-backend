const { Router } = require("express");
const router = Router();
const checkAccountStatus = require("../middlewares/checkAccountStatus")


const {
    createHelpSupport,
    getUserHelpRequests,
    getTicketById,
    replyToTicket,
    deleteTicket,
} = require("../controllers/helpSupportController");

router.post("/create", checkAccountStatus, createHelpSupport);
router.get("/get", checkAccountStatus, getUserHelpRequests);
router.get("/:id", checkAccountStatus, getTicketById);
router.post("/:id/reply", checkAccountStatus, replyToTicket);
router.delete("/:id", checkAccountStatus, deleteTicket);

module.exports = router;

// const express = require("express");
// const router = express.Router();
// const {
//   createHelpSupportTicket,
//   getAllHelpSupportTickets,
//   getHelpSupportTicketById,
//   replyToHelpSupportTicket,
//   deleteHelpSupportTicket,
// } = require("../controllers/helpSupportController");
// // const { authMiddleware } = require("../middlewares/auth");

// // Create Ticket (User & Company Admin)
// router.post("/create", createHelpSupportTicket);

// // Get Tickets (role-based)
// router.get("/", getAllHelpSupportTickets);

// // Get Ticket by ID
// router.get("/:id", getHelpSupportTicketById);

// // Reply to Ticket (Company Admin / Super Admin)
// router.post("/:id/reply", replyToHelpSupportTicket);

// // Delete Ticket (Super Admin only)
// router.delete("/:id", deleteHelpSupportTicket);

// module.exports = router;

