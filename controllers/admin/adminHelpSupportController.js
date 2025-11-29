const mongoose = require("mongoose");
const HelpSupport = require("../../models/helpSupportModel");
const User = require("../../models/userModel");
const {
  sendHelpSupportReply,
  sendHelpSupportReplyNotification,
} = require("../../utils/emailUtils");

// GET all help support tickets
const getAllHelpSupportTickets = async (req, res) => {
  try {
    console.log("Fetching all help support tickets");

    const {
      page = 1,
      limit = 10,
      inquiryType,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
      status,
      startDate,
      endDate,
    } = req.query;

    // Build filter query
    let filter = {};

    // Status filtering - support multiple statuses
    if (status && status !== "all") {
      const statusArray = Array.isArray(status) ? status : status.split(",");
      if (statusArray.length > 0) {
        filter.status = { $in: statusArray };
      }
    }

    // Type filtering - support multiple types
    if (inquiryType && inquiryType !== "All") {
      const typeArray = Array.isArray(inquiryType)
        ? inquiryType
        : inquiryType.split(",");
      if (typeArray.length > 0) {
        filter.inquiryType = { $in: typeArray };
      }
    }

    // Date range filtering
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        // Add one day to include the end date
        const end = new Date(endDate);
        end.setDate(end.getDate() + 1);
        filter.createdAt.$lt = end;
      }
    }

    // Search filtering
    if (search) {
      const searchFilter = [
        { name: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
        { message: { $regex: search, $options: "i" } },
        { emailaddresses: { $regex: search, $options: "i" } },
      ];

      // If there's already a filter, combine with AND
      if (Object.keys(filter).length > 0) {
        filter = {
          $and: [filter, { $or: searchFilter }],
        };
      } else {
        filter.$or = searchFilter;
      }
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Get tickets with user details
    const tickets = await HelpSupport.find(filter)
      .populate({
        path: "userId",
        select: "firstname lastname email phonenumbers",
      })
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalTickets = await HelpSupport.countDocuments(filter);
    const totalPages = Math.ceil(totalTickets / parseInt(limit));

    // Get summary statistics
    const stats = await HelpSupport.aggregate([
      {
        $group: {
          _id: "$inquiryType",
          count: { $sum: 1 },
        },
      },
    ]);

    const totalCount = await HelpSupport.countDocuments();

    res.status(200).json({
      status: "success",
      message: "Help support tickets retrieved successfully",
      data: {
        tickets,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalTickets,
          limit: parseInt(limit),
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1,
        },
        stats: {
          total: totalCount,
          byType: stats.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
          }, {}),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching help support tickets:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// GET single help support ticket by ID
const getHelpSupportTicketById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid ticket ID",
      });
    }

    const ticket = await HelpSupport.findById(id).populate({
      path: "userId",
      select: "firstname lastname email phonenumbers profileImage",
    });

    if (!ticket) {
      return res.status(404).json({
        status: "error",
        message: "Help support ticket not found",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Help support ticket retrieved successfully",
      data: ticket,
    });
  } catch (error) {
    console.error("Error fetching help support ticket:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// POST - Reply to help support ticket (add message to chat)
const replyToHelpSupportTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid ticket ID",
      });
    }

    if (!message || message.trim() === "") {
      return res.status(400).json({
        status: "error",
        message: "Message is required",
      });
    }

    // Find the ticket with user details
    const ticket = await HelpSupport.findById(id).populate({
      path: "userId",
      select: "firstname lastname email",
    });

    if (!ticket) {
      return res.status(404).json({
        status: "error",
        message: "Help support ticket not found",
      });
    }

    // Check if ticket is closed
    if (ticket.status === "closed") {
      return res.status(400).json({
        status: "error",
        message: "Cannot reply to a closed ticket",
      });
    }

    // Add new message to the chat
    const newMessage = {
      sender: "admin",
      content: message.trim(),
      timestamp: new Date(),
      senderInfo: req.user._id,
    };

    // Get user's primary email
    let userEmail = null;
    if (ticket.userId && ticket.userId.email) {
      userEmail = ticket.userId.email;
    } else if (ticket.emailaddresses && ticket.emailaddresses.length > 0) {
      userEmail = ticket.emailaddresses[0];
    }

    if (!userEmail) {
      return res.status(400).json({
        status: "error",
        message: "No email address found for this user",
      });
    }

    // Send email notification about new reply
    const userName = ticket.userId
      ? `${ticket.userId.firstname || ""} ${
          ticket.userId.lastname || ""
        }`.trim()
      : ticket.name || "Valued Customer";

    // Update this to use a new email template for chat notification
    await sendHelpSupportReplyNotification(
      userEmail,
      userName,
      ticket.subject,
      message.trim(),
      ticket._id
    );

    // Update ticket with new message and set status to 'replied'
    await HelpSupport.findByIdAndUpdate(id, {
      $push: { messages: newMessage },
      $set: {
        status: "replied",
        lastMessageAt: new Date(),
        lastRepliedAt: new Date(),
        repliedBy: req.user._id,
      },
    });

    res.status(200).json({
      status: "success",
      message: "Reply sent successfully",
      data: {
        sentTo: userEmail,
        userName,
        repliedAt: new Date(),
        messageId: newMessage._id,
      },
    });
  } catch (error) {
    console.error("Error replying to help support ticket:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// DELETE help support ticket
const deleteHelpSupportTicket = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid ticket ID",
      });
    }

    const ticket = await HelpSupport.findByIdAndDelete(id);

    if (!ticket) {
      return res.status(404).json({
        status: "error",
        message: "Help support ticket not found",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Help support ticket deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting help support ticket:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// GET help support dashboard stats
const getHelpSupportStats = async (req, res) => {
  try {
    // Get current date for filtering
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get total tickets
    const totalTickets = await HelpSupport.countDocuments();

    // Get tickets by inquiry type
    const ticketsByType = await HelpSupport.aggregate([
      {
        $group: {
          _id: "$inquiryType",
          count: { $sum: 1 },
        },
      },
    ]);

    // Get recent tickets (today, this week, this month)
    const todayTickets = await HelpSupport.countDocuments({
      createdAt: { $gte: startOfDay },
    });

    const thisWeekTickets = await HelpSupport.countDocuments({
      createdAt: { $gte: startOfWeek },
    });

    const thisMonthTickets = await HelpSupport.countDocuments({
      createdAt: { $gte: startOfMonth },
    });

    // Get tickets with replies (both legacy adminReply and new messages system)
    const repliedTickets = await HelpSupport.countDocuments({
      $or: [
        { adminReply: { $exists: true, $ne: null, $ne: "" } },
        { "messages.sender": "admin" },
      ],
    });

    const pendingTickets = totalTickets - repliedTickets;

    res.status(200).json({
      status: "success",
      message: "Help support statistics retrieved successfully",
      data: {
        overview: {
          total: totalTickets,
          replied: repliedTickets,
          pending: pendingTickets,
          today: todayTickets,
          thisWeek: thisWeekTickets,
          thisMonth: thisMonthTickets,
        },
        byType: ticketsByType.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),
        replyRate:
          totalTickets > 0
            ? ((repliedTickets / totalTickets) * 100).toFixed(2)
            : 0,
      },
    });
  } catch (error) {
    console.error("Error fetching help support stats:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

module.exports = {
  getAllHelpSupportTickets,
  getHelpSupportTicketById,
  replyToHelpSupportTicket,
  deleteHelpSupportTicket,
  getHelpSupportStats,
};
