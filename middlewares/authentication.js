// const { validateToken } = require("../services/authentication");

// const checkForAuthentication = () => {
//   return (req, res, next) => {
//     const authHeader = req.headers["authorization"];

//     if (!authHeader) {
//       return res
//         .status(401)
//         .json({ message: "Unauthorized: No token provided" });
//     }

//     const token = authHeader.split(" ")[1];
//     if (!token) {
//       return res
//         .status(401)
//         .json({ message: "Unauthorized: Invalid token format" });
//     }

//     try {
//       const payload = validateToken(token);
//       req.user = payload;
//     } catch (error) {
//       return res.status(401).json({ message: "Invalid or expired token" });
//     }

//     next();
//   };
// };

// module.exports = { checkForAuthentication };

const { validateToken } = require("../services/authentication");
const User = require("../models/userModel");

const checkForAuthentication = () => {
  return async (req, res, next) => {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
      return res.status(401).json({ message: "Unauthorized: No token provided" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Invalid token format" });
    }

    try {
      const payload = validateToken(token);

      const user = await User.findById(payload._id).select("activeSessions activeSessionId");

      if (!user) {
        return res.status(401).json({ message: "Unauthorized: User not found" });
      }

      // ✅ MULTI-SESSION ENFORCEMENT
      const isSessionActive = user.activeSessions.some(s => s.sessionId === payload.sessionId);

      // Fallback for sessions created before this update (if any) or if matching legacy field
      const isLegacySession = user.activeSessionId === payload.sessionId;

      if (!isSessionActive && !isLegacySession) {
        return res.status(401).json({
          message: "Your session has expired or you are logged in on another device.",
        });
      }

      req.user = payload;
      next();
    } catch (error) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  };
};

module.exports = { checkForAuthentication };
