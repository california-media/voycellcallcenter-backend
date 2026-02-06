const User = require("../../models/userModel");
const crypto = require("crypto");
const { sendEmailChangeVerification } = require("../../utils/emailUtils");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

exports.getAllCompanyAdmins = async (req, res) => {
  try {
    let page = parseInt(req.body.page) || 1;
    let limit = parseInt(req.body.limit) || 10;
    let skip = (page - 1) * limit;

    const search = req.body.search?.trim() || "";

    const searchQuery = search
      ? {
        $or: [
          { firstname: { $regex: search, $options: "i" } },
          { lastname: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { extensionNumber: { $regex: search, $options: "i" } },
          { telephone: { $regex: search, $options: "i" } },
          { "phonenumbers.number": { $regex: search, $options: "i" } },
        ],
      }
      : {};

    const companyAdmins = await User.find({
      role: "companyAdmin",
      ...searchQuery,
    })
      .select(
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret extensionStatus accountStatus userInfo.companyName"
      )
      .skip(skip)
      .limit(limit)
      .lean();

    const totalAdmins = await User.countDocuments({
      role: "companyAdmin",
      ...searchQuery,
    });

    res.status(200).json({
      status: "success",
      message: "company admin fetched",
      page,
      limit,
      totalAdmins,
      totalPages: Math.ceil(totalAdmins / limit),
      data: companyAdmins,
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.getAgentsOfCompanyAdmin = async (req, res) => {
  try {
    const adminId = req.body.adminId;
    if (!adminId) {
      return res.status(400).json({ message: "adminId is required" });
    }

    let page = parseInt(req.body.page) || 1;
    let limit = parseInt(req.body.limit) || 10;
    let skip = (page - 1) * limit;

    const search = req.body.search?.trim() || "";

    const searchQuery = search
      ? {
        $or: [
          { firstname: { $regex: search, $options: "i" } },
          { lastname: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { extensionNumber: { $regex: search, $options: "i" } },
          { telephone: { $regex: search, $options: "i" } },
          { "phonenumbers.number": { $regex: search, $options: "i" } },
        ],
      }
      : {};

    const agents = await User.find({
      role: "user",
      createdByWhichCompanyAdmin: adminId,
      ...searchQuery,
    })
      .select(
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret createdByWhichCompanyAdmin extensionStatus accountStatus"
      )
      .skip(skip)
      .limit(limit)
      .lean();

    const totalAgents = await User.countDocuments({
      role: "user",
      createdByWhichCompanyAdmin: adminId,
      ...searchQuery,
    });

    res.status(200).json({
      status: "success",
      message: "agents fetched",
      adminId,
      page,
      limit,
      totalAgents,
      totalPages: Math.ceil(totalAgents / limit),
      data: agents,
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.getCompanyAdminDetails = async (req, res) => {
  try {
    const adminId = req.body.adminId;

    const admin = await User.findOne({
      _id: adminId,
      role: "companyAdmin",
    })
      .select(
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret extensionStatus accountStatus userInfo.companyName"
      )
      .lean();

    if (!admin) {
      return res.status(404).json({ message: "Company Admin not found" });
    }

    res.status(200).json({
      status: "success",
      message: "admin details fetched",
      data: admin,
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.getAgentDetails = async (req, res) => {
  try {
    const agentId = req.body.agentId;

    const agent = await User.findOne({
      _id: agentId,
      role: "user",
    })
      .select(
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret createdByWhichCompanyAdmin extensionStatus accountStatus"
      )
      .lean();

    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    // Also fetch admin details
    const admin = await User.findById(agent.createdByWhichCompanyAdmin)
      .select("_id firstname lastname email")
      .lean();

    res.status(200).json({
      status: "success",
      message: "agent details fetched",
      data: agent,
      admin,
    });
  } catch (error) {
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.editCompanyAdminAndAgent = async (req, res) => {
  try {
    const { userId, extensionNumber, telephone, status, newEmail } = req.body;

    console.log(
      "Received body:",
      userId,
      extensionNumber,
      telephone,
      status,
      newEmail
    );
    console.log("new email:", newEmail);

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // Fetch the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Handle email change if newEmail is provided and different from current
    let emailVerificationSent = false;
    if (newEmail && newEmail.trim() !== "" && newEmail !== user.email) {
      // Check if new email already exists for another user
      const existingUser = await User.findOne({
        email: newEmail,
        _id: { $ne: userId },
      });
      if (existingUser) {
        return res.status(400).json({
          error: "This email address is already in use by another account.",
        });
      }

      // Generate email change verification token
      const emailChangeToken = crypto.randomBytes(32).toString("hex");

      // Store pending email change data
      user.pendingEmailChange = {
        newEmail: newEmail,
        token: emailChangeToken,
        createdAt: new Date(),
      };

      // Send verification email
      const verificationLink = `${FRONTEND_URL}/verify-email-change?token=${emailChangeToken}`;

      try {
        await sendEmailChangeVerification(
          newEmail,
          user.email,
          `${user.firstname || ""} ${user.lastname || ""}`.trim() || user.email,
          user._id.toString(),
          verificationLink
        );
        emailVerificationSent = true;
        console.log("✅ Email change verification sent to:", newEmail);
      } catch (emailError) {
        console.error("❌ Failed to send verification email:", emailError);
        return res.status(500).json({
          error: "Failed to send verification email. Please try again.",
        });
      }
    }

    // Allowed fields only
    const updateData = {};

    // Determine if the request intends to activate the extension status.
    // Accept either boolean true or string 'active' as activation intent.
    const isActivating =
      status === true || status === "active" || status === "Active";

    // If activation is requested, require both fields to be provided and non-empty.
    if (isActivating) {
      const missing = [];
      if (!extensionNumber || String(extensionNumber).trim() === "")
        missing.push("Extension Number");
      if (!telephone || String(telephone).trim() === "")
        missing.push("Telephone");

      if (missing.length > 0) {
        return res.status(400).json({
          error:
            "To activate extension status, the following fields are required: " +
            missing.join(", ") +
            ".",
        });
      }
    }

    if (extensionNumber !== undefined)
      updateData.extensionNumber = extensionNumber;
    if (telephone !== undefined) updateData.telephone = telephone;

    if (status !== undefined)
      updateData.extensionStatus = isActivating ? true : false;

    // Add pending email change to update data if it exists
    if (user.pendingEmailChange) {
      updateData.pendingEmailChange = user.pendingEmailChange;
    }

    // Update in DB
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    ).select(
      "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret extensionStatus accountStatus userInfo.companyName"
    );

    res.status(200).json({
      status: "success",
      message: "User updated successfully",
      emailVerificationSent: emailVerificationSent,
      updatedUser,
    });
  } catch (error) {
    console.error("❌ Error updating user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.verifyEmailChange = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        status: "error",
        message: "Verification token is required",
      });
    }

    // Find user with matching token
    const user = await User.findOne({
      "pendingEmailChange.token": token,
    });

    if (!user) {
      return res.status(400).json({
        status: "error",
        message: "Invalid or expired verification token",
      });
    }

    // Check if token is expired (optional: 24 hour expiry)
    const tokenAge = new Date() - new Date(user.pendingEmailChange.createdAt);
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (tokenAge > twentyFourHours) {
      user.pendingEmailChange = undefined;
      await user.save();
      return res.status(400).json({
        status: "error",
        message:
          "Verification token has expired. Please request a new email change.",
      });
    }

    // Update email and clear pending change
    const oldEmail = user.email;
    const newEmail = user.pendingEmailChange.newEmail;

    user.email = newEmail;
    user.pendingEmailChange = undefined;
    await user.save();

    console.log(
      `✅ Email changed successfully from ${oldEmail} to ${newEmail} for user ${user._id}`
    );

    res.status(200).json({
      status: "success",
      message: "Email verified and updated successfully",
      data: {
        userId: user._id,
        newEmail: user.email,
      },
    });
  } catch (error) {
    console.error("❌ Error verifying email change:", error);
    res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
};

exports.updateMultipleYeastarUsersBySuperAdmin = async (req, res) => {
  try {
    const superAdminId = req.user._id;

    const {
      users = [],

      YEASTAR_BASE_URL,
      YEASTAR_USERNAME,
      YEASTAR_PASSWORD,
      YEASTAR_SDK_ACCESS_ID,
      YEASTAR_SDK_ACCESS_KEY,
      YEASTAR_USER_AGENT,
    } = req.body;

    // 1️⃣ Super Admin Check
    const superAdmin = await User.findById(superAdminId);
    if (!superAdmin || superAdmin.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can perform this action.",
      });
    }

    if (!users.length) {
      return res.status(400).json({
        success: false,
        message: "Users array is required.",
      });
    }

    const updatedUsers = [];

    // 2️⃣ Loop All Users
    for (const u of users) {
      const {
        userId,
        YEASTER_EXTENSION_NUMBER,
        YEASTER_EXTENSION_ID,
        YEASTER_SIP_SECRET,
        YEASTER_TELEPHONE,
      } = u;

      const targetUser = await User.findById(userId);
      if (!targetUser) continue;

      if (!targetUser.yeastarDetails) {
        targetUser.yeastarDetails = {};
      }

      // 3️⃣ Common PBX Details (Same)
      if (YEASTAR_BASE_URL !== undefined)
        targetUser.yeastarDetails.YEASTAR_BASE_URL =
          YEASTAR_BASE_URL;

      if (YEASTAR_USERNAME !== undefined)
        targetUser.yeastarDetails.YEASTAR_USERNAME =
          YEASTAR_USERNAME;

      if (YEASTAR_PASSWORD !== undefined)
        targetUser.yeastarDetails.YEASTAR_PASSWORD =
          YEASTAR_PASSWORD;

      if (YEASTAR_SDK_ACCESS_ID !== undefined)
        targetUser.yeastarDetails.YEASTAR_SDK_ACCESS_ID =
          YEASTAR_SDK_ACCESS_ID;

      if (YEASTAR_SDK_ACCESS_KEY !== undefined)
        targetUser.yeastarDetails.YEASTAR_SDK_ACCESS_KEY =
          YEASTAR_SDK_ACCESS_KEY;

      if (YEASTAR_USER_AGENT !== undefined)
        targetUser.yeastarDetails.YEASTAR_USER_AGENT =
          YEASTAR_USER_AGENT;

      // 4️⃣ Unique Extension Details
      if (YEASTER_EXTENSION_NUMBER !== undefined)
        targetUser.yeastarDetails.YEASTER_EXTENSION_NUMBER =
          YEASTER_EXTENSION_NUMBER;

      if (YEASTER_EXTENSION_ID !== undefined)
        targetUser.yeastarDetails.YEASTER_EXTENSION_ID =
          YEASTER_EXTENSION_ID;

      if (YEASTER_SIP_SECRET !== undefined)
        targetUser.yeastarDetails.YEASTER_SIP_SECRET =
          YEASTER_SIP_SECRET;

      if (YEASTER_TELEPHONE !== undefined)
        targetUser.yeastarDetails.YEASTER_TELEPHONE =
          YEASTER_TELEPHONE;

      await targetUser.save();

      updatedUsers.push({
        userId: targetUser._id,
        extension: YEASTER_EXTENSION_NUMBER,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Multiple users Yeastar details updated.",
      totalUpdated: updatedUsers.length,
      data: updatedUsers,
    });
  } catch (error) {
    console.error("❌ Multi Yeastar Update Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

exports.addYeastarDeviceBySuperAdmin = async (req, res) => {
  try {
    const superAdminId = req.user._id;

    const {
      deviceName,

      YEASTAR_BASE_URL,
      YEASTAR_USERNAME,
      YEASTAR_PASSWORD,
      YEASTAR_SDK_ACCESS_ID,
      YEASTAR_SDK_ACCESS_KEY,
      YEASTAR_USER_AGENT,
    } = req.body;

    // 1️⃣ Check Super Admin
    const superAdmin = await User.findById(superAdminId);

    if (!superAdmin || superAdmin.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can add devices.",
      });
    }

    // 2️⃣ Create Device Object
    const newDevice = {
      deviceName,

      YEASTAR_BASE_URL,
      YEASTAR_USERNAME,
      YEASTAR_PASSWORD,
      YEASTAR_SDK_ACCESS_ID,
      YEASTAR_SDK_ACCESS_KEY,
      YEASTAR_USER_AGENT,
    };

    // 3️⃣ Push into array
    superAdmin.yeastarDevices.push(newDevice);

    await superAdmin.save();

    return res.status(200).json({
      success: true,
      message: "Yeastar device added successfully.",
      data: newDevice,
    });
  } catch (error) {
    console.error("❌ Add Device Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

exports.getAllYeastarDevicesBySuperAdmin = async (req, res) => {
  try {
    const superAdminId = req.user._id;

    const superAdmin = await User.findById(superAdminId);

    if (!superAdmin || superAdmin.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can view devices.",
      });
    }

    return res.status(200).json({
      success: true,
      totalDevices: superAdmin.yeastarDevices.length,
      data: superAdmin.yeastarDevices,
    });
  } catch (error) {
    console.error("❌ Get Devices Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

exports.updateYeastarDeviceBySuperAdmin = async (req, res) => {
  try {
    const superAdminId = req.user._id;
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: "deviceId is required.",
      });
    }

    // SuperAdmin Check
    const superAdmin = await User.findById(superAdminId);

    if (!superAdmin || superAdmin.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can update devices.",
      });
    }

    // 🔥 FIX → ObjectId compare
    const device = superAdmin.yeastarDevices.find(
      (d) => d.deviceId.toString() === deviceId.toString()
    );

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found.",
      });
    }

    // Allowed fields
    const allowedUpdates = [
      "deviceName",
      "YEASTAR_BASE_URL",
      "YEASTAR_USERNAME",
      "YEASTAR_PASSWORD",
      "YEASTAR_SDK_ACCESS_ID",
      "YEASTAR_SDK_ACCESS_KEY",
      "YEASTAR_USER_AGENT",
      "isActive",
    ];

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        device[field] = req.body[field];
      }
    });

    await superAdmin.save();

    return res.status(200).json({
      success: true,
      message: "Device updated successfully.",
      data: device,
    });
  } catch (error) {
    console.error("❌ Update Device Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};



exports.deleteYeastarDeviceBySuperAdmin = async (req, res) => {
  try {
    const superAdminId = req.user._id;
    const { deviceId } = req.body;

    const superAdmin = await User.findById(superAdminId);

    if (!superAdmin || superAdmin.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can delete devices.",
      });
    }

    superAdmin.yeastarDevices =
      superAdmin.yeastarDevices.filter(
        (d) => d._id.toString() !== deviceId
      );

    await superAdmin.save();

    return res.status(200).json({
      success: true,
      message: "Device deleted successfully.",
    });
  } catch (error) {
    console.error("❌ Delete Device Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};


// exports.updateFullYeastarBySuperAdmin = async (req, res) => {
//   try {
//     const superAdminId = req.user._id;

//     const {
//       userId,

//       YEASTAR_BASE_URL,
//       YEASTAR_USERNAME,
//       YEASTAR_PASSWORD,
//       YEASTAR_SDK_ACCESS_ID,
//       YEASTAR_SDK_ACCESS_KEY,
//       YEASTAR_USER_AGENT,

//       YEASTER_EXTENSION_NUMBER,
//       YEASTER_EXTENSION_ID,
//       YEASTER_SIP_SECRET,
//       YEASTER_TELEPHONE,
//     } = req.body;

//     // 1️⃣ Check super admin
//     const superAdmin = await User.findById(superAdminId);
//     if (!superAdmin || superAdmin.role !== "superadmin") {
//       return res.status(403).json({
//         success: false,
//         message: "Only Super Admin can perform this action.",
//       });
//     }

//     // 2️⃣ Validate target user
//     const targetUser = await User.findById(userId);
//     if (!targetUser) {
//       return res.status(404).json({
//         success: false,
//         message: "Target user not found.",
//       });
//     }

//     // 3️⃣ Ensure object exists
//     if (!targetUser.yeastarDetails) {
//       targetUser.yeastarDetails = {};
//     }

//     // 4️⃣ Update Yeastar Details (Nested Object)

//     if (YEASTAR_BASE_URL !== undefined)
//       targetUser.yeastarDetails.YEASTAR_BASE_URL = YEASTAR_BASE_URL;

//     if (YEASTAR_USERNAME !== undefined)
//       targetUser.yeastarDetails.YEASTAR_USERNAME = YEASTAR_USERNAME;

//     if (YEASTAR_PASSWORD !== undefined)
//       targetUser.yeastarDetails.YEASTAR_PASSWORD = YEASTAR_PASSWORD;

//     if (YEASTAR_SDK_ACCESS_ID !== undefined)
//       targetUser.yeastarDetails.YEASTAR_SDK_ACCESS_ID =
//         YEASTAR_SDK_ACCESS_ID;

//     if (YEASTAR_SDK_ACCESS_KEY !== undefined)
//       targetUser.yeastarDetails.YEASTAR_SDK_ACCESS_KEY =
//         YEASTAR_SDK_ACCESS_KEY;

//     if (YEASTAR_USER_AGENT !== undefined)
//       targetUser.yeastarDetails.YEASTAR_USER_AGENT =
//         YEASTAR_USER_AGENT;

//     if (YEASTER_EXTENSION_NUMBER !== undefined)
//       targetUser.yeastarDetails.YEASTER_EXTENSION_NUMBER =
//         YEASTER_EXTENSION_NUMBER;

//     if (YEASTER_EXTENSION_ID !== undefined)
//       targetUser.yeastarDetails.YEASTER_EXTENSION_ID =
//         YEASTER_EXTENSION_ID;

//     if (YEASTER_SIP_SECRET !== undefined)
//       targetUser.yeastarDetails.YEASTER_SIP_SECRET =
//         YEASTER_SIP_SECRET;

//     if (YEASTER_TELEPHONE !== undefined)
//       targetUser.yeastarDetails.YEASTER_TELEPHONE =
//         YEASTER_TELEPHONE;

//     await targetUser.save();

//     return res.status(200).json({
//       success: true,
//       message: "Yeastar details updated successfully.",
//       data: targetUser.yeastarDetails,
//     });
//   } catch (error) {
//     console.error("❌ Yeastar Full Update Error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal Server Error",
//     });
//   }
// };