const User = require("../models/userModel");

const getUserData = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();

    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    const data = {
      id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      gender: user.gender,
      email: user.email,
      profileImageURL: user.profileImageURL,
      instagram: user.instagram,
      linkedin: user.linkedin,
      telegram: user.telegram,
      twitter: user.twitter,
      facebook: user.facebook,
      designation: user.designation,
      signupMethod: user.signupMethod,
      role: user.role,
      referredBy: user.referredBy || null,
      myReferrals: user.myReferrals || [],
      referralCode: user.referralCode || null,
      isActive: user.isActive,
      lastSeen: user.lastSeen,
      isVerified: user.isVerified,
      userInfo: user.userInfo || {
        helps: [],
        goals: "",
        categories: "",
        employeeCount: "",
        companyName: "",
      },
      extensionNumber: user.extensionNumber || null,
      yeastarExtensionId: user.yeastarExtensionId || null,
      sipSecret: user.sipSecret || null,
      yeastarProvisionStatus: user.yeastarProvisionStatus || "pending",
      yeastarProvisionError: user.yeastarProvisionError || "",
    };

    return res.json({
      status: "success",
      message: "User data fetched successfully.",
      data,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
};

module.exports = { getUserData };
