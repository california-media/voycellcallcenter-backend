const User = require("../../models/userModel");
const Subscription = require("../../models/Subscription");
const Invoice = require("../../models/Invoice");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { sendEmailChangeVerification } = require("../../utils/emailUtils");
// const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const getDeviceToken = require("../../services/yeastarTokenService").getDeviceToken;
const axios = require("axios");
const { getConfig } = require("../../utils/getConfig");

// exports.getAllCompanyAdmins = async (req, res) => {
//   try {
//     let page = parseInt(req.body.page) || 1;
//     let limit = parseInt(req.body.limit) || 10;
//     let skip = (page - 1) * limit;

//     const search = req.body.search?.trim() || "";

//     const searchQuery = search
//       ? {
//         $or: [
//           { firstname: { $regex: search, $options: "i" } },
//           { lastname: { $regex: search, $options: "i" } },
//           { email: { $regex: search, $options: "i" } },
//           { "PBXDetails.PBX_EXTENSION_NUMBER": { $regex: search, $options: "i" } },
//           { telephone: { $regex: search, $options: "i" } },
//           { "phonenumbers.number": { $regex: search, $options: "i" } },
//         ],
//       }
//       : {};

//     const [companyAdmins, totalAdmins] = await Promise.all([
//       User.find({ role: "companyAdmin", ...searchQuery })
//         .select(
//           "_id firstname lastname email createdAt extensionNumber PBXDetails telephone phonenumbers sipSecret extensionStatus accountStatus userInfo.companyName planStatus trialStartedAt trialEndsAt trialDurationDays"
//         )
//         .skip(skip)
//         .limit(limit)
//         .lean(),
//       User.countDocuments({ role: "companyAdmin", ...searchQuery }),
//     ]);

//     // Attach active subscription info (plan name) for each company admin
//     const userIds = companyAdmins.map((u) => u._id);
//     const subscriptions = await Subscription.find({
//       userId: { $in: userIds },
//       status: { $in: ["active", "trialing", "paused"] },
//     }).populate("planId", "name").lean();

//     const subMap = {};
//     subscriptions.forEach((s) => { subMap[s.userId.toString()] = s; });

//     const data = companyAdmins.map((u) => ({
//       ...u,
//       subscription: subMap[u._id.toString()] || null,
//     }));

//     res.status(200).json({
//       status: "success",
//       message: "company admin fetched",
//       page,
//       limit,
//       totalAdmins,
//       totalPages: Math.ceil(totalAdmins / limit),
//       data,
//     });
//   } catch (error) {
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// };


exports.getAllCompanyAdmins = async (req, res) => {
  try {
    let page = parseInt(req.body.page) || 1;
    let limit = parseInt(req.body.limit) || 10;
    let skip = (page - 1) * limit;

    const search = req.body.search?.trim() || "";

    // 🔍 STEP 1: Find matching agents (users)
    let agentAdminIds = [];

    if (search) {
      const agents = await User.find({
        role: "user",
        $or: [
          { firstname: { $regex: search, $options: "i" } },
          { lastname: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { telephone: { $regex: search, $options: "i" } },
          { "phonenumbers.number": { $regex: search, $options: "i" } },
          { "PBXDetails.PBX_EXTENSION_NUMBER": { $regex: search, $options: "i" } },
        ],
      }).select("createdByWhichCompanyAdmin");

      agentAdminIds = agents
        .map((a) => a.createdByWhichCompanyAdmin)
        .filter((id) => id); // remove null
    }

    // 🔍 STEP 2: Build company admin query
    const companyAdminQuery = {
      role: "companyAdmin",
    };

    if (search) {
      companyAdminQuery.$or = [
        // 🔹 Admin fields
        { firstname: { $regex: search, $options: "i" } },
        { lastname: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { telephone: { $regex: search, $options: "i" } },
        { "phonenumbers.number": { $regex: search, $options: "i" } },
        { "PBXDetails.PBX_EXTENSION_NUMBER": { $regex: search, $options: "i" } },

        // 🔹 Company name
        { "userInfo.companyName": { $regex: search, $options: "i" } },

        // 🔹 Match via agent
        { _id: { $in: agentAdminIds } },
      ];
    }

    // 🔍 STEP 3: Fetch company admins
    const [companyAdmins, totalAdmins] = await Promise.all([
      User.find(companyAdminQuery)
        .select(
          "_id firstname lastname email createdAt extensionNumber PBXDetails telephone phonenumbers sipSecret extensionStatus accountStatus userInfo.companyName planStatus trialStartedAt trialEndsAt trialDurationDays"
        )
        .skip(skip)
        .limit(limit)
        .lean(),

      User.countDocuments(companyAdminQuery),
    ]);

    // 🔍 STEP 4: Attach subscription info
    const userIds = companyAdmins.map((u) => u._id);

    const subscriptions = await Subscription.find({
      userId: { $in: userIds },
      status: { $in: ["active", "trialing", "paused"] },
    })
      .populate("planId", "name")
      .lean();

    const subMap = {};
    subscriptions.forEach((s) => {
      subMap[s.userId.toString()] = s;
    });

    const data = companyAdmins.map((u) => ({
      ...u,
      subscription: subMap[u._id.toString()] || null,
    }));

    // ✅ FINAL RESPONSE
    res.status(200).json({
      status: "success",
      message: "company admin fetched",
      page,
      limit,
      totalAdmins,
      totalPages: Math.ceil(totalAdmins / limit),
      data,
    });
  } catch (error) {
    console.error("Error in getAllCompanyAdmins:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};


exports.getAllCompanyAdminsByDevice = async (req, res) => {
  try {
    let page = parseInt(req.body.page) || 1;
    let limit = parseInt(req.body.limit) || 10;
    let skip = (page - 1) * limit;

    const search = req.body.search?.trim() || "";
    const deviceId = req.body.deviceId || null;

    // 🔍 Search Query
    const searchQuery = search
      ? {
        $or: [
          { firstname: { $regex: search, $options: "i" } },
          { lastname: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { "PBXDetails.PBX_EXTENSION_NUMBER": { $regex: search, $options: "i" } },
          { telephone: { $regex: search, $options: "i" } },
          { "phonenumbers.number": { $regex: search, $options: "i" } },
        ],
      }
      : {};

    // 🧠 Base Query
    let query = {
      role: "companyAdmin",
      ...searchQuery,
    };

    // 🆕 Device Filter (if provided)
    if (deviceId) {
      query["PBXDetails.assignedDeviceId"] = deviceId;
    }

    const companyAdmins = await User.find(query)
      .select(
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret extensionStatus accountStatus userInfo.companyName PBXDetails"
      )
      .skip(skip)
      .limit(limit)
      .lean();

    const totalAdmins = await User.countDocuments(query);

    res.status(200).json({
      status: "success",
      message: "company admin fetched",
      page,
      limit,
      deviceId,
      totalAdmins,
      totalPages: Math.ceil(totalAdmins / limit),
      data: companyAdmins,
    });
  } catch (error) {
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
          { "PBXDetails.PBX_EXTENSION_NUMBER": { $regex: search, $options: "i" } },
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
        "_id firstname lastname email createdAt extensionNumber PBXDetails telephone phonenumbers sipSecret createdByWhichCompanyAdmin extensionStatus accountStatus"
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
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.getAgentsOfCompanyAdminByDevice = async (req, res) => {
  try {
    const adminId = req.body.adminId;
    const deviceId = req.body.deviceId || null;

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
          { "PBXDetails.PBX_EXTENSION_NUMBER": { $regex: search, $options: "i" } },
          { telephone: { $regex: search, $options: "i" } },
          { "phonenumbers.number": { $regex: search, $options: "i" } },
        ],
      }
      : {};

    // 🧠 Base Query
    let query = {
      role: "user",
      createdByWhichCompanyAdmin: adminId,
      ...searchQuery,
    };

    // 🆕 Device Filter
    if (deviceId) {
      query["PBXDetails.assignedDeviceId"] = deviceId;
    }

    const agents = await User.find(query)
      .select(
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret createdByWhichCompanyAdmin extensionStatus accountStatus PBXDetails"
      )
      .skip(skip)
      .limit(limit)
      .lean();

    const totalAgents = await User.countDocuments(query);

    res.status(200).json({
      status: "success",
      message: "agents fetched",
      adminId,
      deviceId,
      page,
      limit,
      totalAgents,
      totalPages: Math.ceil(totalAgents / limit),
      data: agents,
    });
  } catch (error) {
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
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret extensionStatus accountStatus userInfo.companyName PBXDetails"
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
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret createdByWhichCompanyAdmin extensionStatus accountStatus PBXDetails"
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
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.editCompanyAdminAndAgent = async (req, res) => {
  // const {FRONTEND_URL} = getConfig()
  try {
    const {
      userId,
      extensionNumber,
      telephone,
      status,
      newEmail,
      assignedDeviceId,
      PBX_EXTENSION_ID,
      PBX_SIP_SECRET,
    } = req.body;

    const PBX_EXTENSION_NUMBER = extensionNumber;
    const PBX_TELEPHONE = telephone;

    console.log("Edit Request Received:", {
      userId,
      extensionNumber,
      telephone,
      status,
      newEmail,
    });

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // 🔍 Fetch user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // 🔍 Detect role
    const isCompanyAdmin = user.role === "companyAdmin";
    const isAgentUser = user.role === "user";

    let selectedDevice = null;
    let deviceOwnerSuperAdmin = null;
    let finalAssignedDeviceId = assignedDeviceId;

    // =========================================================
    // 🧠 CASE 1 → COMPANY ADMIN DEVICE ASSIGN
    // =========================================================
    if (isCompanyAdmin && assignedDeviceId) {
      deviceOwnerSuperAdmin = await User.findOne({
        role: "superadmin",
        "PBXDevices.deviceId": assignedDeviceId,
      });

      if (!deviceOwnerSuperAdmin) {
        return res.status(400).json({
          error: "Device not found under any SuperAdmin.",
        });
      }

      selectedDevice =
        deviceOwnerSuperAdmin.PBXDevices.find(
          (d) =>
            d.deviceId.toString() ===
            assignedDeviceId.toString()
        );
    }

    // =========================================================
    // 🧠 CASE 2 → USER (AGENT) DEVICE AUTO-ASSIGN
    // =========================================================
    if (isAgentUser) {
      // 1️⃣ Find Company Admin
      const companyAdmin = await User.findById(
        user.createdByWhichCompanyAdmin
      );

      if (!companyAdmin) {
        return res.status(400).json({
          error: "Company Admin not found for this user.",
        });
      }

      if (!companyAdmin.PBXDetails?.assignedDeviceId) {
        return res.status(400).json({
          error:
            "No PBX device assigned to this Company Admin.",
        });
      }

      finalAssignedDeviceId =
        companyAdmin.PBXDetails.assignedDeviceId;

      // 2️⃣ Find SuperAdmin owning device
      deviceOwnerSuperAdmin = await User.findOne({
        role: "superadmin",
        "PBXDevices.deviceId": finalAssignedDeviceId,
      });

      if (!deviceOwnerSuperAdmin) {
        return res.status(400).json({
          error: "Device not found under SuperAdmin.",
        });
      }

      // 3️⃣ Get device object
      selectedDevice =
        deviceOwnerSuperAdmin.PBXDevices.find(
          (d) =>
            d.deviceId.toString() ===
            finalAssignedDeviceId.toString()
        );
    }

    // =========================================================
    // ❌ DEVICE VALIDATION
    // =========================================================
    if (selectedDevice && !selectedDevice.isActive) {
      return res.status(400).json({
        error: "Selected PBX device is inactive.",
      });
    }

    // =========================================================
    // 📧 EMAIL CHANGE LOGIC (UNCHANGED)
    // =========================================================
    let emailVerificationSent = false;

    if (
      newEmail &&
      newEmail.trim() !== "" &&
      newEmail !== user.email
    ) {
      const existingUser = await User.findOne({
        email: newEmail,
        _id: { $ne: userId },
      });

      if (existingUser) {
        return res.status(400).json({
          error:
            "This email address is already in use.",
        });
      }

      const emailChangeToken =
        crypto.randomBytes(32).toString("hex");

      user.pendingEmailChange = {
        newEmail,
        token: emailChangeToken,
        createdAt: new Date(),
      };

      const verificationLink = `${FRONTEND_URL}/verify-email-change?token=${emailChangeToken}`;

      await sendEmailChangeVerification(
        newEmail,
        user.email,
        `${user.firstname || ""} ${user.lastname || ""
          }`.trim() || user.email,
        user._id.toString(),
        verificationLink
      );

      emailVerificationSent = true;
    }

    // =========================================================
    // 📦 UPDATE OBJECT
    // =========================================================
    const updateData = {};

    // 🆕 PBX DETAILS ASSIGN
    if (selectedDevice) {
      // ===============================================
      // 🚫 CHECK DUPLICATE EXTENSION NUMBER
      // ===============================================

      if (PBX_EXTENSION_NUMBER) {
        const existingExtensionUser = await User.findOne({
          _id: { $ne: userId }, // exclude current user
          role: { $in: ["companyAdmin", "user"] },
          "PBXDetails.PBX_EXTENSION_NUMBER": PBX_EXTENSION_NUMBER,
        });



        if (existingExtensionUser) {

          const fullName = `${existingExtensionUser.firstname} ${existingExtensionUser.lastname}`.trim();

          const userRole = existingExtensionUser.role === "companyAdmin" ? "Company Admin" : "User";

          return res.status(400).json({
            error: `Extension ${PBX_EXTENSION_NUMBER} is already used by ${fullName} (${userRole}).`,
          });
        }
      }

      // ===============================================
      // 🚫 CHECK DUPLICATE TELEPHONE NUMBER
      // ===============================================

      if (PBX_TELEPHONE) {
        const existingTelephoneUser = await User.findOne({
          _id: { $ne: userId }, // exclude current user
          role: { $in: ["companyAdmin", "user"] },
          "PBXDetails.PBX_TELEPHONE": PBX_TELEPHONE,
        });



        if (existingTelephoneUser) {

          const fullName = `${existingTelephoneUser.firstname} ${existingTelephoneUser.lastname}`.trim();

          const userRole = existingTelephoneUser.role === "companyAdmin" ? "Company Admin" : "User";

          return res.status(400).json({
            error: `Telephone ${PBX_TELEPHONE} is already used by ${fullName} (${userRole}).`,
          });
        }
      }

      updateData.PBXDetails = {
        PBX_BASE_URL:
          selectedDevice.PBX_BASE_URL,
        PBX_USERNAME:
          selectedDevice.PBX_USERNAME,
        PBX_PASSWORD:
          selectedDevice.PBX_PASSWORD,
        PBX_SDK_ACCESS_ID:
          selectedDevice.PBX_SDK_ACCESS_ID,
        PBX_SDK_ACCESS_KEY:
          selectedDevice.PBX_SDK_ACCESS_KEY,
        PBX_USER_AGENT:
          selectedDevice.PBX_USER_AGENT,

        assignedDeviceId:
          finalAssignedDeviceId,

        PBX_EXTENSION_NUMBER,
        PBX_EXTENSION_ID,
        PBX_SIP_SECRET,
        PBX_TELEPHONE,
      };
      updateData.extensionStatus = true; // auto-activate if device assigned
    }

    if (status !== undefined)
      updateData.extensionStatus = status === true || status === "active" || status === "Active"
    // isActivating ? true : false;

    if (user.pendingEmailChange) {
      updateData.pendingEmailChange =
        user.pendingEmailChange;
    }

    // =========================================================
    // 💾 DB UPDATE
    // =========================================================
    const updatedUser =
      await User.findByIdAndUpdate(
        userId,
        { $set: updateData },
        { new: true }
      ).select(
        "_id firstname lastname email extensionNumber telephone extensionStatus PBXDetails"
      );

    return res.status(200).json({
      status: "success",
      message:
        "User / Company Admin updated successfully",
      emailVerificationSent,
      updatedUser,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Internal Server Error" });
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

    res.status(200).json({
      status: "success",
      message: "Email verified and updated successfully",
      data: {
        userId: user._id,
        newEmail: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
};

exports.updateMultipleYeastarUsersBySuperAdmin = async (req, res) => {
  try {
    const superAdminId = req.user._id;
    const { users = [] } = req.body;

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

    // =========================================================
    // 🧠 STEP 1 — Group users by deviceId
    // =========================================================
    const deviceUserMap = {};

    for (const u of users) {
      if (!deviceUserMap[u.deviceId]) {
        deviceUserMap[u.deviceId] = [];
      }
      deviceUserMap[u.deviceId].push(u);
    }

    // =========================================================
    // 🧠 STEP 2 — Loop each device
    // =========================================================
    for (const deviceId in deviceUserMap) {

      // 2️⃣ Find Device From SuperAdmin
      const device = superAdmin.PBXDevices.find(
        (d) => d.deviceId.toString() === deviceId.toString()
      );

      if (!device) {
        deviceUserMap[deviceId].forEach((u) => {
          updatedUsers.push({
            userId: u.userId,
            status: "failed",
            reason: "Device not found",
          });
        });
        continue;
      }

      // =========================================================
      // 🔐 STEP 3 — Generate Token ONCE per device
      // =========================================================
      let token;

      try {
        token = await getDeviceToken(deviceId, "pbx");
      } catch (err) {
        deviceUserMap[deviceId].forEach((u) => {
          updatedUsers.push({
            userId: u.userId,
            status: "failed",
            reason: "PBX authentication failed",
          });
        });
        continue;
      }

      // =========================================================
      // 🧠 STEP 4 — Loop Users of this device
      // =========================================================
      for (const u of deviceUserMap[deviceId]) {

        const {
          userId,
          PBX_EXTENSION_NUMBER,
          PBX_EXTENSION_ID,
          PBX_SIP_SECRET,
          PBX_TELEPHONE,
        } = u;

        // 4️⃣ Find Target User
        const targetUser = await User.findById(userId);
        if (!targetUser) {
          updatedUsers.push({
            userId,
            status: "failed",
            reason: "User not found",
          });
          continue;
        }

        // =====================================================
        // 💾 STEP 7 — Assign PBX Details
        // =====================================================
        if (!targetUser.PBXDetails) {
          targetUser.PBXDetails = {};
        }

        targetUser.PBXDetails.PBX_BASE_URL = device.PBX_BASE_URL;
        targetUser.PBXDetails.PBX_USERNAME = device.PBX_USERNAME;
        targetUser.PBXDetails.PBX_PASSWORD = device.PBX_PASSWORD;
        targetUser.PBXDetails.PBX_SDK_ACCESS_ID = device.PBX_SDK_ACCESS_ID;
        targetUser.PBXDetails.PBX_SDK_ACCESS_KEY = device.PBX_SDK_ACCESS_KEY;
        targetUser.PBXDetails.PBX_USER_AGENT = device.PBX_USER_AGENT;

        targetUser.PBXDetails.PBX_EXTENSION_NUMBER =
          PBX_EXTENSION_NUMBER;

        targetUser.PBXDetails.PBX_EXTENSION_ID =
          PBX_EXTENSION_ID;

        targetUser.PBXDetails.PBX_SIP_SECRET =
          PBX_SIP_SECRET;

        targetUser.PBXDetails.PBX_TELEPHONE =
          PBX_TELEPHONE;

        targetUser.PBXDetails.assignedDeviceId =
          deviceId;

        targetUser.extensionStatus = true;
        targetUser.yeastarProvisionStatus = "done";

        await targetUser.save();

        updatedUsers.push({
          userId,
          deviceId,
          extension: PBX_EXTENSION_NUMBER,
          status: "success",
        });
      }
    }

    // =========================================================
    // ✅ FINAL RESPONSE
    // =========================================================
    return res.status(200).json({
      success: true,
      message: "PBX assigned to multiple users successfully.",
      totalUpdated: updatedUsers.length,
      data: updatedUsers,
    });

  } catch (error) {
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
      PBX_BASE_URL,
      PBX_USERNAME,
      PBX_PASSWORD,
      PBX_SDK_ACCESS_ID,
      PBX_SDK_ACCESS_KEY,
      PBX_USER_AGENT,
    } = req.body;

    // 1️⃣ Check Super Admin
    const superAdmin = await User.findById(superAdminId);

    if (!superAdmin || superAdmin.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can add devices.",
      });
    }

    // 2️⃣ 🔐 Validate PBX Credentials
    try {
      const pbxRes = await axios.post(
        `${PBX_BASE_URL}/get_token`,
        {
          username: PBX_USERNAME,
          password: PBX_PASSWORD,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent":
              PBX_USER_AGENT || "Voycell-App",
          },
          timeout: 10000,
        }
      );

      if (!pbxRes.data?.access_token) {
        throw new Error("PBX auth failed");
      }

    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid PBX credentials.",
      });
    }

    // 3️⃣ 🔐 Validate SDK Credentials
    try {
      const sdkRes = await axios.post(
        `${PBX_BASE_URL}/get_token`,
        {
          username: PBX_SDK_ACCESS_ID,
          password: PBX_SDK_ACCESS_KEY,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent":
              PBX_USER_AGENT || "Voycell-App",
          },
          timeout: 10000,
        }
      );

      if (!sdkRes.data?.access_token) {
        throw new Error("SDK auth failed");
      }
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid SDK credentials.",
      });
    }

    // 4️⃣ Create deviceId AFTER validation
    const deviceId = new mongoose.Types.ObjectId();

    const newDevice = {
      deviceId,
      deviceName,
      PBX_BASE_URL,
      PBX_USERNAME,
      PBX_PASSWORD,
      PBX_SDK_ACCESS_ID,
      PBX_SDK_ACCESS_KEY,
      PBX_USER_AGENT,
    };

    // 5️⃣ Save device
    superAdmin.PBXDevices.push(newDevice);
    await superAdmin.save();

    // 6️⃣ Generate & store tokens using service
    await getDeviceToken(deviceId, "pbx");
    await getDeviceToken(deviceId, "sdk");

    return res.status(200).json({
      success: true,
      message:
        "PBX device validated, added & tokens generated.",
      data: newDevice,
    });
  } catch (error) {
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

    // ✅ Get all devices
    const devices = superAdmin.PBXDevices || [];

    // ✅ Map devices with assigned user count
    const devicesWithCounts = await Promise.all(
      devices.map(async (device) => {
        const assignedCount = await User.countDocuments({
          "PBXDetails.assignedDeviceId": device.deviceId,
        });

        return {
          ...device.toObject(),
          assignedUsersCount: assignedCount,
        };
      })
    );

    return res.status(200).json({
      success: true,
      totalDevices: devices.length,
      data: devicesWithCounts,
    });
  } catch (error) {
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

    // 1️⃣ Verify SuperAdmin
    const superAdmin = await User.findById(superAdminId);

    if (!superAdmin || superAdmin.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can update devices.",
      });
    }

    // 2️⃣ Find Device
    const device = superAdmin.PBXDevices.find(
      (d) => d.deviceId.toString() === deviceId.toString()
    );

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found.",
      });
    }

    // 3️⃣ Allowed fields
    const allowedUpdates = [
      "deviceName",
      "PBX_BASE_URL",
      "PBX_USERNAME",
      "PBX_PASSWORD",
      "PBX_SDK_ACCESS_ID",
      "PBX_SDK_ACCESS_KEY",
      "PBX_USER_AGENT",
      "isActive",
    ];

    allowedUpdates.forEach((field) => {
      if (req.body[field] !== undefined) {
        device[field] = req.body[field];
      }
    });

    await superAdmin.save();

    // ======================================================
    // 🔥 4️⃣ CASCADE UPDATE → Assigned Users/Admins
    // ======================================================

    const updatePayload = {
      "PBXDetails.PBX_BASE_URL": device.PBX_BASE_URL,
      "PBXDetails.PBX_USERNAME": device.PBX_USERNAME,
      "PBXDetails.PBX_PASSWORD": device.PBX_PASSWORD,
      "PBXDetails.PBX_SDK_ACCESS_ID": device.PBX_SDK_ACCESS_ID,
      "PBXDetails.PBX_SDK_ACCESS_KEY": device.PBX_SDK_ACCESS_KEY,
      "PBXDetails.PBX_USER_AGENT": device.PBX_USER_AGENT,
    };

    // 🆕 If device inactive → disable all extensions
    if (device.isActive === false) {
      updatePayload["extensionStatus"] = false;
    }

    // Bulk update
    const result = await User.updateMany(
      { "PBXDetails.assignedDeviceId": deviceId },
      { $set: updatePayload }
    );

    // ======================================================

    return res.status(200).json({
      success: true,
      message:
        device.isActive === false
          ? "Device disabled & all assigned extensions deactivated."
          : "Device updated & synced to assigned users.",
      updatedDevice: device,
      affectedUsers: result.modifiedCount,
    });
  } catch (error) {
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

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: "deviceId is required",
      });
    }

    // 1️⃣ Verify Super Admin
    const superAdmin = await User.findById(superAdminId);

    if (!superAdmin || superAdmin.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can delete devices.",
      });
    }

    // 2️⃣ Check device exists
    const deviceExists = superAdmin.PBXDevices.find(
      (d) => d.deviceId.toString() === deviceId.toString()
    );

    if (!deviceExists) {
      return res.status(404).json({
        success: false,
        message: "Device not found.",
      });
    }

    // 3️⃣ Remove device from SuperAdmin
    superAdmin.PBXDevices = superAdmin.PBXDevices.filter(
      (d) => d.deviceId.toString() !== deviceId.toString()
    );

    await superAdmin.save();

    // 4️⃣ Find all users + company admins assigned to this device
    const affectedUsers = await User.find({
      "PBXDetails.assignedDeviceId": deviceId,
    });

    // 5️⃣ Reset extension + device details
    for (const user of affectedUsers) {
      user.PBXDetails.assignedDeviceId = null;

      // Reset extension / provisioning data
      user.extensionNumber = null;
      user.yeastarExtensionId = null;
      user.sipSecret = null;

      user.extensionStatus = false;
      user.yeastarProvisionStatus = "pending";
      user.yeastarProvisionError = "";

      // Optional: Clear PBX credentials if stored per user
      user.PBXDetails.PBX_BASE_URL = "";
      user.PBXDetails.PBX_USERNAME = "";
      user.PBXDetails.PBX_PASSWORD = "";
      user.PBXDetails.PBX_SDK_ACCESS_ID = "";
      user.PBXDetails.PBX_SDK_ACCESS_KEY = "";
      user.PBXDetails.PBX_USER_AGENT = "";

      await user.save();
    }

    return res.status(200).json({
      status: "success",
      message: "Device deleted & all assigned users reset successfully.",
      affectedUsers: affectedUsers.length,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
};

exports.getYeastarDeviceById = async (req, res) => {
  try {
    const superAdminId = req.user._id;
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: "deviceId is required.",
      });
    }

    // ✅ Check Super Admin
    const superAdmin = await User.findById(superAdminId);

    if (!superAdmin || superAdmin.role !== "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can view devices.",
      });
    }

    // ✅ Find Device
    const device = superAdmin.PBXDevices.find(
      (d) => d.deviceId.toString() === deviceId
    );

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found.",
      });
    }

    // ✅ Count Assigned Users
    const assignedUsersCount = await User.countDocuments({
      "PBXDetails.assignedDeviceId": deviceId,
    });

    // ✅ Response
    return res.status(200).json({
      success: true,
      data: {
        ...device.toObject(),
        assignedUsersCount, // 👈 Added count
      },
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};
// ─── Get Company Billing Details (superAdmin) ─────────────────────────────────
exports.getCompanyBillingDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const user = await User.findById(userId)
      .select("firstname lastname email planStatus trialStartedAt trialEndsAt trialDurationDays stripeCustomerId createdAt")
      .lean();

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Sync Stripe invoices if user has a Stripe customer (handles local dev without webhooks)
    if (user.stripeCustomerId) {
      const stripeService = require("../../services/stripeService");
      try {
        const result = await stripeService.listInvoices(user.stripeCustomerId, 100);
        const sub = await Subscription.findOne({ userId }).sort({ createdAt: -1 });
        for (const si of result.data || []) {
          if (si.status === "draft") continue;
          const lineItem = si.lines?.data?.[0];
          const periodStart = lineItem?.period?.start
            ? new Date(lineItem.period.start * 1000)
            : (si.period_start ? new Date(si.period_start * 1000) : null);
          const periodEnd = lineItem?.period?.end
            ? new Date(lineItem.period.end * 1000)
            : (si.period_end ? new Date(si.period_end * 1000) : null);
          await Invoice.findOneAndUpdate(
            { stripeInvoiceId: si.id },
            {
              userId: user._id,
              subscriptionId: sub?._id || null,
              planId: sub?.planId || null,
              stripeInvoiceId: si.id,
              stripeCustomerId: user.stripeCustomerId,
              stripeChargeId: si.charge || null,
              invoiceNumber: si.number || null,
              amount: si.amount_due,
              amountPaid: si.amount_paid,
              currency: si.currency,
              status: si.status,
              invoicePdf: si.invoice_pdf || null,
              hostedInvoiceUrl: si.hosted_invoice_url || null,
              billingPeriodStart: periodStart,
              billingPeriodEnd: periodEnd,
              stripeCreatedAt: si.created ? new Date(si.created * 1000) : null,
            },
            { upsert: true, new: true }
          );
        }
      } catch (_) { }
    }

    const subscription = await Subscription.findOne({
      userId,
      status: { $in: ["trialing", "active", "paused", "cancelled"] },
    })
      .populate("planId", "name pricing")
      .sort({ createdAt: -1 })
      .lean();

    const [invoices, totalInvoices] = await Promise.all([
      Invoice.find({ userId })
        .populate("planId", "name")
        .sort({ stripeCreatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Invoice.countDocuments({ userId }),
    ]);

    const mongoose = require("mongoose");
    const paidSummary = await Invoice.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId.toString()) } },
      { $group: { _id: null, totalPaid: { $sum: "$amountPaid" }, totalDue: { $sum: "$amount" } } },
    ]);

    res.json({
      success: true,
      user,
      subscription,
      invoices,
      totalInvoices,
      page,
      limit,
      totalPaid: paidSummary[0]?.totalPaid || 0,
      totalDue: paidSummary[0]?.totalDue || 0,
    });
  } catch (err) {
    console.error("getCompanyBillingDetails error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch billing details" });
  }
};
