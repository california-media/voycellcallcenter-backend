const User = require("../models/userModel");
const { createTokenforUser } = require("../services/authentication");
const crypto = require("crypto");

const generateApiKey = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // Generate a new API key (JWT token with extended expiration)
    const apiKey = createTokenforUser(user);

    // You could also store the API key in the user document if needed
    // For now, we'll just return the generated token

    return res.status(200).json({
      status: "success",
      message: "API key generated successfully",
      data: {
        apiKey: apiKey,
        userId: user._id,
        email: user.email,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Generate API key error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to generate API key",
      error: error.message,
    });
  }
};

const getCurrentApiKey = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // For now, we'll generate a new API key each time
    // In a production environment, you might want to store and retrieve existing keys
    const apiKey = createTokenforUser(user);

    return res.status(200).json({
      status: "success",
      message: "API key retrieved successfully",
      data: {
        apiKey: apiKey,
        userId: user._id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Get API key error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to retrieve API key",
      error: error.message,
    });
  }
};

module.exports = {
  generateApiKey,
  getCurrentApiKey,
};
