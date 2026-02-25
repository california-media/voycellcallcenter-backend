// middlewares/roleMiddleware.js

const User = require('../models/userModel');

const checkRole = (requiredRoles = []) => {
  return async (req, res, next) => {
    try {
      const userId = req.user._id; // assuming req.user is set from auth middleware

      const user = await User.findById(userId).select('role');

      if (!user) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }

      if (!requiredRoles.includes(user.role)) {
        return res.status(403).json({ status: 'error', message: 'Access denied' });
      }

      next();
    } catch (err) {
      res.status(500).json({ status: 'error', message: 'Internal server error', error: err.message });
    }
  };
};

module.exports = checkRole;