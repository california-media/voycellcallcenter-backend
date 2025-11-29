const path = require("path");
const mongoose = require("mongoose");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const HelpSupport = require("../models/helpSupportModel");
const s3 = require("../utils/s3");
const User = require("../models/userModel");
// ADD this at the top (with your other requires)
const { parsePhoneNumberFromString } = require("libphonenumber-js");

// Upload file to S3
const uploadImageToS3 = async (file) => {
  const ext = path.extname(file.originalname);
  const name = path.basename(file.originalname, ext);
  const fileName = `helpAndSupportAttachments/${name}_${Date.now()}${ext}`;

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  try {
    await s3.send(new PutObjectCommand(params));
    return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
  } catch (error) {
    console.error("S3 upload failed:", error);
    throw new Error("Image upload failed");
  }
};

// Create Help & Support Request
const createHelpSupport = async (req, res) => {
  try {
    const userId = req.user._id;

    const {
      name,
      subject,
      emailaddresses,
      phonenumber,
      countryCode,
      inquiryType,
      message,
      subscribe,
      apiType = "web", // <-- ADDED (defaults to "web")
    } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    console.log(req.body.name);

    console.log("Received Help & Support request:", {
      userId,
      name,
      subject,
      emailaddresses,
      phonenumber,
      countryCode,
      inquiryType,
      message,
      subscribe,
      file: req.file ? req.file.originalname : null,
    });

    // ✅ file comes from multer
    let fileUrl = null;
    if (req.file) {
      fileUrl = await uploadImageToS3(req.file);
    }

    // ✅ parse emailaddresses (JSON array or single string)
    let parsedEmails = [];
    if (emailaddresses) {
      try {
        parsedEmails = Array.isArray(emailaddresses)
          ? emailaddresses
          : JSON.parse(emailaddresses);
      } catch {
        parsedEmails = [emailaddresses];
      }
    }

    // ✅ parse phone
    // let parsedPhones = [];
    // if (phonenumber && countryCode) {
    //     parsedPhones.push({
    //         countryCode: String(countryCode).replace(/[^\d]/g, ""),
    //         number: String(phonenumber).replace(/[^\d]/g, ""),
    //     });
    // }

    // ✅ parse phone(s) by apiType
    let parsedPhones = [];

    if (apiType === "mobile") {
      // Mobile sends separate fields
      if (phonenumber && countryCode) {
        parsedPhones.push({
          countryCode: String(countryCode).replace(/[^\d]/g, ""), // keep only digits
          number: String(phonenumber).replace(/[^\d]/g, ""), // keep only digits
        });
      }
    } else if (apiType === "web") {
      // Web sends ONE combined number (may lack '+')
      // 1) Ensure leading '+'; 2) Parse via libphonenumber-js; 3) Split into country code + national number
      if (phonenumber) {
        // Normalize input
        let raw = String(phonenumber).trim();

        // If it doesn't start with '+', add it (also handle leading '00')
        if (!raw.startsWith("+")) {
          // remove spaces first to avoid "+ 91..." cases
          raw = raw.replace(/\s+/g, "");
          if (raw.startsWith("00")) {
            raw = "+" + raw.slice(2);
          } else {
            // keep only digits and then prefix '+'
            raw = "+" + raw.replace(/[^\d]/g, "");
          }
        }

        try {
          const phone = parsePhoneNumberFromString(raw); // libphonenumber-js
          if (phone) {
            parsedPhones.push({
              countryCode: phone.countryCallingCode, // e.g., "91"
              number: phone.nationalNumber, // e.g., "7046658651"
              // e164: phone.number,                 // optional full +E.164 if you want to store it
            });
          }
        } catch (e) {
          // If parsing fails, you can either ignore or fallback to raw digits
          // Fallback (optional): push raw digits with best-effort
          // const justDigits = raw.replace(/[^\d]/g, "");
          // if (justDigits) parsedPhones.push({ countryCode: "", number: justDigits });
        }
      }
    }

    const helpRequest = new HelpSupport({
      userId,
      name,
      subject,
      emailaddresses: parsedEmails,
      phonenumbers: parsedPhones,
      inquiryType,
      message,
      fileUrl,
      subscribe: subscribe === "true" || subscribe === true,
    });

    await helpRequest.save();

    res.status(201).json({
      status: "success",
      message: "Help & Support request submitted successfully",
      data: helpRequest,
    });
  } catch (error) {
    console.error("Error creating help support:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Get all requests of a user
const getUserHelpRequests = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      page = 1,
      limit = 10,
      status,
      inquiryType,
      search,
      startDate,
      endDate,
    } = req.query;

    // Build filter query
    let filter = { userId };

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
      ];

      // Combine with existing filter
      if (Object.keys(filter).length > 1) {
        // More than just userId
        filter = {
          $and: [filter, { $or: searchFilter }],
        };
      } else {
        filter.$or = searchFilter;
        filter.userId = userId; // Re-add userId
      }
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const requests = await HelpSupport.find(filter)
      .populate({
        path: "messages.senderInfo",
        select: "firstname lastname email role",
      })
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalTickets = await HelpSupport.countDocuments(filter);
    const totalPages = Math.ceil(totalTickets / parseInt(limit));

    res.status(200).json({
      status: "success",
      message: "Help & Support requests fetched successfully",
      data: {
        tickets: requests,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalTickets,
          limit: parseInt(limit),
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Get single ticket by ID for the current user
const getTicketById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid ticket ID",
      });
    }

    const ticket = await HelpSupport.findOne({ _id: id, userId }).populate({
      path: "messages.senderInfo",
      select: "firstname lastname email role",
    });

    if (!ticket) {
      return res.status(404).json({
        status: "error",
        message: "Ticket not found",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Ticket retrieved successfully",
      data: ticket,
    });
  } catch (error) {
    console.error("Error fetching ticket:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Reply to a ticket (customer reply)
const replyToTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const userId = req.user._id;

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

    // Find the ticket and verify ownership
    const ticket = await HelpSupport.findOne({ _id: id, userId });

    if (!ticket) {
      return res.status(404).json({
        status: "error",
        message: "Ticket not found",
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
      sender: "customer",
      content: message.trim(),
      timestamp: new Date(),
      senderInfo: userId,
    };

    // Update ticket with new message and set status to 'pending'
    await HelpSupport.findByIdAndUpdate(id, {
      $push: { messages: newMessage },
      $set: {
        status: "pending",
        lastMessageAt: new Date(),
      },
    });

    res.status(200).json({
      status: "success",
      message: "Reply sent successfully",
      data: {
        messageId: newMessage._id,
        timestamp: newMessage.timestamp,
      },
    });
  } catch (error) {
    console.error("Error replying to ticket:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

// Delete ticket by ID for the current user
const deleteTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid ticket ID",
      });
    }

    // Find and delete the ticket, but only if it belongs to the current user
    const ticket = await HelpSupport.findOneAndDelete({
      _id: id,
      userId: userId, // Ensure the ticket belongs to the current user
    });

    if (!ticket) {
      return res.status(404).json({
        status: "error",
        message: "Ticket not found or you don't have permission to delete it",
      });
    }

    res.status(200).json({
      status: "success",
      message: "Ticket deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting ticket:", error);
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

module.exports = {
  createHelpSupport,
  getUserHelpRequests,
  getTicketById,
  replyToTicket,
  deleteTicket,
};

// const mongoose = require("mongoose");
// const HelpSupport = require("../models/helpSupportModel");
// const User = require("../models/userModel");
// const { sendHelpSupportReplyNotification } = require("../utils/emailUtils");
// const s3 = require("../utils/s3");
// const { PutObjectCommand } = require("@aws-sdk/client-s3");

// // Upload file to S3
// const uploadImageToS3 = async (file) => {
//     const ext = path.extname(file.originalname);
//     const name = path.basename(file.originalname, ext);
//     const fileName = `helpAndSupportAttachments/${name}_${Date.now()}${ext}`;

//     const params = {
//         Bucket: process.env.AWS_BUCKET_NAME,
//         Key: fileName,
//         Body: file.buffer,
//         ContentType: file.mimetype,
//     };

//     try {
//         await s3.send(new PutObjectCommand(params));
//         return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
//     } catch (error) {
//         console.error("S3 upload failed:", error);
//         throw new Error("Image upload failed");
//     }
// };

// // ✅ CREATE Ticket (User / Company Admin)
// exports.createHelpSupportTicket = async (req, res) => {
//     try {
//         const {
//             name,
//             subject,
//             emailaddresses,
//             phonenumbers,
//             inquiryType,
//             message,
//             // fileUrl,
//             subscribe,
//         } = req.body;

//         const user = await User.findById(req.user._id);
//         if (!user)
//             return res.status(404).json({ status: "error", message: "User not found" });
//         //  ✅ file comes from multer
//         let fileUrl = null;
//         if (req.file) {
//             fileUrl = await uploadImageToS3(req.file);
//         }
//         const createdByRole = user.role === "companyAdmin" ? "companyAdmin" : "user";
//         let parsedPhoneNumbers = [];

//         if (phonenumbers) {
//             try {
//                 // Parse if stringified JSON (comes from form-data)
//                 parsedPhoneNumbers = typeof phonenumbers === "string"
//                     ? JSON.parse(phonenumbers)
//                     : phonenumbers;
//             } catch (e) {
//                 console.error("❌ Invalid phonenumbers format:", e);
//                 return res.status(400).json({
//                     status: "error",
//                     message: "Invalid phonenumbers format. Must be JSON array.",
//                 });
//             }
//         }

//         console.log(user.createdByWhichCompanyAdmin);

//         const ticket = await HelpSupport.create({
//             userId: user._id,
//             companyId: user.createdByWhichCompanyAdmin || null,
//             createdByRole,
//             name: name || `${user.firstname} ${user.lastname}`,
//             subject,
//             emailaddresses:
//                 emailaddresses?.length > 0
//                     ? emailaddresses
//                     : [user.email || `${user.firstname}@example.com`],
//             // phonenumbers: phonenumbers || user.phonenumbers || [],
//             phonenumbers: parsedPhoneNumbers.length > 0 ? parsedPhoneNumbers : user.phonenumbers || [],
//             inquiryType,
//             message,
//             fileUrl,
//             subscribe: subscribe || false,
//             messages: [
//                 {
//                     sender: createdByRole,
//                     senderInfo: user._id,
//                     content: message,
//                 },
//             ],
//         });

//         res.status(201).json({
//             status: "success",
//             message: "Help & Support ticket created successfully",
//             data: ticket,
//         });
//     } catch (error) {
//         console.error("Error creating HelpSupport ticket:", error);
//         res.status(500).json({ status: "error", message: error.message });
//     }
// };

// // ✅ GET all tickets (role-based)
// exports.getAllHelpSupportTickets = async (req, res) => {
//     try {
//         const user = await User.findById(req.user._id);
//         if (!user)
//             return res.status(404).json({ status: "error", message: "User not found" });

//         let filter = {};
//         if (user.role === "user") {
//             filter.userId = user._id;
//         } else if (user.role === "companyAdmin") {
//             filter.companyId = user.createdByWhichCompanyAdmin;
//         } // superAdmin => all

//         const tickets = await HelpSupport.find(filter)
//             .populate("userId", "firstname lastname email role companyId")
//             .populate("repliedBy", "firstname lastname email role")
//             .sort({ createdAt: -1 });

//         res.status(200).json({
//             status: "success",
//             message: "Tickets fetched successfully",
//             data: tickets,
//         });
//     } catch (error) {
//         console.error("Error fetching tickets:", error);
//         res.status(500).json({ status: "error", message: error.message });
//     }
// };

// // ✅ GET ticket by ID (role-based)
// exports.getHelpSupportTicketById = async (req, res) => {
//     try {
//         const { id } = req.params;
//         if (!mongoose.Types.ObjectId.isValid(id))
//             return res.status(400).json({ status: "error", message: "Invalid ticket ID" });

//         const ticket = await HelpSupport.findById(id)
//             .populate("userId", "firstname lastname email role companyId")
//             .populate("messages.senderInfo", "firstname lastname email role");

//         if (!ticket)
//             return res.status(404).json({ status: "error", message: "Ticket not found" });

//         const user = await User.findById(req.user._id);
//         if (user.role === "user" && ticket.userId._id.toString() !== user._id.toString())
//             return res.status(403).json({ status: "error", message: "Unauthorized" });

//         if (
//             user.role === "companyAdmin" &&
//             ticket.companyId?.toString() !== user.companyId?.toString()
//         )
//             return res.status(403).json({ status: "error", message: "Unauthorized" });

//         res.status(200).json({
//             status: "success",
//             message: "Ticket retrieved successfully",
//             data: ticket,
//         });
//     } catch (error) {
//         console.error("Error fetching ticket:", error);
//         res.status(500).json({ status: "error", message: error.message });
//     }
// };

// // ✅ REPLY to Ticket (Company Admin / Super Admin)
// exports.replyToHelpSupportTicket = async (req, res) => {
//     try {
//         const { id } = req.params;
//         const { message } = req.body;

//         if (!mongoose.Types.ObjectId.isValid(id))
//             return res.status(400).json({ status: "error", message: "Invalid ticket ID" });

//         if (!message || message.trim() === "")
//             return res.status(400).json({ status: "error", message: "Message is required" });

//         const user = await User.findById(req.user._id);
//         const ticket = await HelpSupport.findById(id).populate("userId");

//         if (!ticket)
//             return res.status(404).json({ status: "error", message: "Ticket not found" });

//         // Authorization check
//         if (user.role === "companyAdmin") {
//             if (ticket.companyId?.toString() !== user.companyId?.toString())
//                 return res.status(403).json({ status: "error", message: "Unauthorized" });
//         } else if (user.role !== "superAdmin") {
//             return res.status(403).json({ status: "error", message: "Unauthorized" });
//         }

//         const senderRole = user.role;

//         // Add reply
//         const newMessage = {
//             sender: senderRole,
//             senderInfo: user._id,
//             content: message,
//             timestamp: new Date(),
//         };

//         ticket.messages.push(newMessage);
//         ticket.lastMessageAt = new Date();
//         ticket.lastRepliedAt = new Date();
//         ticket.repliedBy = user._id;
//         await ticket.save();

//         // Send notification to user
//         const userEmail =
//             ticket.userId?.email ||
//             (ticket.emailaddresses?.length > 0 ? ticket.emailaddresses[0] : null);

//         if (userEmail) {
//             await sendHelpSupportReplyNotification(
//                 userEmail,
//                 `${ticket.userId.firstname} ${ticket.userId.lastname}`,
//                 ticket.subject,
//                 message,
//                 ticket._id
//             );
//         }

//         res.status(200).json({
//             status: "success",
//             message: "Reply sent successfully",
//             data: newMessage,
//         });
//     } catch (error) {
//         console.error("Error replying to ticket:", error);
//         res.status(500).json({ status: "error", message: error.message });
//     }
// };

// // ✅ DELETE (Super Admin only)
// exports.deleteHelpSupportTicket = async (req, res) => {
//     try {
//         const user = await User.findById(req.user._id);
//         if (user.role !== "superAdmin")
//             return res.status(403).json({ status: "error", message: "Unauthorized" });

//         const { id } = req.params;
//         await HelpSupport.findByIdAndDelete(id);

//         res.status(200).json({
//             status: "success",
//             message: "Ticket deleted successfully",
//         });
//     } catch (error) {
//         console.error("Error deleting ticket:", error);
//         res.status(500).json({ status: "error", message: error.message });
//     }
// };
