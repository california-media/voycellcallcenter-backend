const mongoose = require("mongoose");

const User = require("../models/userModel");
const Contact = require("../models/contactModel");
const CallHistory = require("../models/CallHistory");
const ScriptToken = require("../models/ScriptToken");
const FormCallScriptToken = require("../models/FormCallScriptToken");
const HelpSupport = require("../models/helpSupportModel");
// const Lead = require("../models/Lead"); // if separate, else Contact handles it

exports.deleteUserPermanently = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        status: "error",
        message: "user_id is required",
      });
    }

    const user = await User.findById(user_id).session(session);

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // ❌ Never delete superadmin
    if (user.role === "superadmin") {
      return res.status(403).json({
        status: "error",
        message: "Superadmin cannot be deleted",
      });
    }

    // ===============================
    // 🏢 COMPANY ADMIN DELETE FLOW
    // ===============================
    if (user.role === "companyAdmin") {
      // 1️⃣ Get all agents under this company admin
      const agents = await User.find(
        { createdByWhichCompanyAdmin: user._id },
        { _id: 1 }
      ).session(session);

      const agentIds = agents.map((a) => a._id);

      const allUserIds = [user._id, ...agentIds];

      // 2️⃣ Delete Contacts & Leads
      await Contact.deleteMany({
        createdBy: { $in: allUserIds },
      }).session(session);

      // 3️⃣ Delete Call History
      await CallHistory.deleteMany({
        userId: { $in: allUserIds },
      }).session(session);

      // 4️⃣ Delete Script Tokens
      await ScriptToken.deleteMany({
        userId: { $in: allUserIds },
      }).session(session);

      await FormCallScriptToken.deleteMany({
        userId: { $in: allUserIds },
      }).session(session);

      // 5️⃣ Delete Help & Support
      await HelpSupport.deleteMany({
        userId: { $in: allUserIds },
      }).session(session);

      // 6️⃣ Delete agents
      await User.deleteMany({
        _id: { $in: agentIds },
      }).session(session);

      // 7️⃣ Delete company admin
      await User.deleteOne({
        _id: user._id,
      }).session(session);

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        status: "success",
        message:
          "Company admin, all agents, and all related data deleted permanently",
      });
    }

    // ===============================
    // 👤 NORMAL USER DELETE FLOW
    // ===============================
    if (user.role === "user") {
      const userId = user._id;

      await Contact.deleteMany({
        createdBy: userId,
      }).session(session);

      await CallHistory.deleteMany({
        userId,
      }).session(session);

      await ScriptToken.deleteMany({
        userId,
      }).session(session);

      await FormCallScriptToken.deleteMany({
        userId,
      }).session(session);

      await HelpSupport.deleteMany({
        userId,
      }).session(session);

      await User.deleteOne({
        _id: userId,
      }).session(session);

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        status: "success",
        message: "User and all related data deleted permanently",
      });
    }

    // Fallback
    await session.abortTransaction();
    session.endSession();

    return res.status(400).json({
      status: "error",
      message: "Invalid role",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("DELETE USER ERROR:", error);

    return res.status(500).json({
      status: "error",
      message: "Failed to delete user and related data",
    });
  }
};
