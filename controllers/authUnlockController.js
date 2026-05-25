const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

const JWT_SECRET = "mysecretkey";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const unlockAccount = async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.redirect(`${FRONTEND_URL}/login?unlocked=error&reason=missing_token`);
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.purpose !== "unlock") {
      return res.redirect(`${FRONTEND_URL}/login?unlocked=error&reason=invalid_token`);
    }

    const user = await User.findOne({ _id: payload.userId, unlockToken: token });
    if (!user) {
      return res.redirect(`${FRONTEND_URL}/login?unlocked=error&reason=token_used_or_invalid`);
    }

    user.lockUntil           = null;
    user.failedLoginAttempts = 0;
    user.firstFailedLoginAt  = null;
    user.unlockToken         = null;
    await user.save();

    return res.redirect(`${FRONTEND_URL}/login?unlocked=success`);
  } catch (err) {
    return res.redirect(`${FRONTEND_URL}/login?unlocked=error&reason=expired`);
  }
};

module.exports = { unlockAccount };
