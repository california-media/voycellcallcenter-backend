const JWT = require("jsonwebtoken");
const secret = "mysecretkey";

const createTokenforUser = (user) => {
  const payload = {
    _id: user._id,
  };
  return (token = JWT.sign(payload, secret));
};

const validateToken = (token) => {
  return (payload = JWT.verify(token, secret));
};

module.exports = { createTokenforUser, validateToken };
