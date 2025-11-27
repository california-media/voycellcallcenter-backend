const User = require("../models/userModel");

const checkAccountStatus = async (req, res, next) => {
  try {
    const userId = req.user?._id; // req.user must come from auth middleware

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized: User not authenticated",
      });
    }

    const user = await User.findById(userId).select("accountStatus");

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized: User not found",
      });
    }

    // ✅ ACTIVE → allow
    if (user.accountStatus === "active") {
      return next();
    }

    // ❌ SUSPENDED → block
    if (user.accountStatus === "suspended") {
      return res.status(403).json({
        status: "error",
        message: "Your account is suspended. Please contact support.",
      });
    }

    // ❌ DEACTIVATED → block
    if (user.accountStatus === "deactivated") {
      return res.status(403).json({
        status: "error",
        message: "Your account is deactivated. Please contact admin.",
      });
    }

    // ❌ fallback (for safety)
    return res.status(403).json({
      status: "error",
      message: "Account access restricted",
    });
  } catch (error) {
    console.error("Account Status Middleware Error:", error);
    return res.status(500).json({
      status: "error",
      message: "Server error while checking account status",
    });
  }
};

module.exports = checkAccountStatus;
