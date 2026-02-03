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

      const user = await User.findById(payload._id).select("activeSessionId");

      if (!user) {
        return res.status(401).json({ message: "Unauthorized: User not found" });
      }

      // // ✅ SINGLE DEVICE ENFORCEMENT
      // if (user.activeSessionId !== payload.sessionId) {
      //   return res.status(401).json({
      //     message: "You are logged in on another device.",
      //   });
      // }

      req.user = payload;
      next();
    } catch (error) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  };
};

module.exports = { checkForAuthentication };
