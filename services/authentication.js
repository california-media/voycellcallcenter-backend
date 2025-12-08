const JWT = require("jsonwebtoken");
const secret = "mysecretkey";

// const createTokenforUser = (user) => {
//   const payload = {
//     _id: user._id,
//   };
//   return (token = JWT.sign(payload, secret));
// };

const createTokenforUser = (user) => {
  const payload = {
    _id: user._id,
    sessionId: user.activeSessionId, // ✅ session lock
  };

  return JWT.sign(payload, secret, {
    expiresIn: "7d", // ✅ security
  });
};

const validateToken = (token) => {
  return (payload = JWT.verify(token, secret));
};

module.exports = { createTokenforUser, validateToken };
