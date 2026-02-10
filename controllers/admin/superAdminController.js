const User = require("../../models/userModel");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { sendEmailChangeVerification } = require("../../utils/emailUtils");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const getDeviceToken = require("../../services/yeastarTokenService").getDeviceToken;
const axios = require("axios");

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
          { "PBXDetails.PBX_EXTENSION_NUMBER": { $regex: search, $options: "i" } },
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
        "_id firstname lastname email createdAt extensionNumber PBXDetails telephone phonenumbers sipSecret extensionStatus accountStatus userInfo.companyName"
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
    console.error("❌ Error:", error);
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
    console.error("❌ Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// exports.editCompanyAdminAndAgent = async (req, res) => {
//   try {
//     const { userId,
//       extensionNumber,
//       telephone,
//       status,
//       newEmail,
//       assignedDeviceId,
//       // PBX_EXTENSION_NUMBER,
//       PBX_EXTENSION_ID,
//       PBX_SIP_SECRET,
//       // PBX_TELEPHONE, 
//     } = req.body;

//     const PBX_EXTENSION_NUMBER = req.body.extensionNumber;
//     const PBX_TELEPHONE = req.body.telephone;

//     console.log(
//       "Received body:",
//       userId,
//       extensionNumber,
//       telephone,
//       status,
//       newEmail
//     );
//     console.log("new email:", newEmail);

//     if (!userId) {
//       return res.status(400).json({ error: "userId is required" });
//     }

//     // Fetch the user
//     const user = await User.findById(userId);
//     if (!user) {
//       return res.status(404).json({ error: "User not found" });
//     }

//     // 🔍 Detect role
//     const isCompanyAdmin = user.role === "companyAdmin";
//     const isAgentUser = user.role === "user";

//     // // 🆕 Fetch SuperAdmin (device owner)
//     // const superAdmin = await User.findOne({ role: "superadmin" });

//     // console.log("SuperAdmin fetched for device assignment:", superAdmin);

//     // if (!superAdmin) {
//     //   return res.status(404).json({
//     //     error: "SuperAdmin not found.",
//     //   });
//     // }

//     if (assignedDeviceId) {
//       console.log("Assigned Device ID:", assignedDeviceId);

//       // 🔥 Fetch correct SuperAdmin who owns this device
//       const superAdmin = await User.findOne({
//         role: "superadmin",
//         "PBXDevices.deviceId": assignedDeviceId,
//       });

//       if (!superAdmin) {
//         return res.status(400).json({
//           error: "Device not found under any SuperAdmin.",
//         });
//       }

//       console.log(
//         "SuperAdmin fetched for device assignment:",
//         superAdmin._id
//       );

//       // 🔍 Find device inside that SuperAdmin
//       selectedDevice = superAdmin.PBXDevices.find(
//         (d) => d.deviceId.toString() === assignedDeviceId.toString()
//       );

//       console.log("Selected Device:", selectedDevice);

//       if (!selectedDevice) {
//         return res.status(400).json({
//           error: "Invalid deviceId. Device not found.",
//         });
//       }

//       if (!selectedDevice.isActive) {
//         return res.status(400).json({
//           error: "Selected PBX device is inactive.",
//         });
//       }
//     }


//     // // 🆕 Validate Extension + Telephone from Yeastar
//     // if (
//     //   assignedDeviceId &&
//     //   PBX_EXTENSION_NUMBER &&
//     //   PBX_TELEPHONE
//     // ) {
//     //   try {
//     //     // 1️⃣ Get Token
//     //     const tokenRes = await axios.post(
//     //       `${selectedDevice.PBX_BASE_URL}/get_token`,
//     //       {
//     //         username: selectedDevice.PBX_USERNAME,
//     //         password: selectedDevice.PBX_PASSWORD,
//     //       },
//     //       {
//     //         headers: {
//     //           "Content-Type": "application/json",
//     //           "X-Access-ID": selectedDevice.PBX_SDK_ACCESS_ID,
//     //           "X-Access-Key": selectedDevice.PBX_SDK_ACCESS_KEY,
//     //           "User-Agent":
//     //             selectedDevice.PBX_USER_AGENT || "Voycell-App",
//     //         },
//     //       }
//     //     );

//     //     const accessToken = tokenRes?.data?.access_token;
//     //     console.log("PBX Access Token obtained:", accessToken);

//     //     if (!accessToken) {
//     //       return res.status(400).json({
//     //         error: "Failed to authenticate PBX device.",
//     //       });
//     //     }

//     //     // 2️⃣ Fetch Extension Details
//     //     const extRes = await axios.get(
//     //       `${selectedDevice.PBX_BASE_URL}/extension/get`,
//     //       {
//     //         headers: {
//     //           Authorization: `Bearer ${accessToken}`,
//     //         },
//     //         params: {
//     //           extension: PBX_EXTENSION_NUMBER,
//     //         },
//     //       }
//     //     );

//     //     const extensionData = extRes?.data?.data;

//     //     if (!extensionData) {
//     //       return res.status(400).json({
//     //         error: "Extension not found in PBX.",
//     //       });
//     //     }

//     //     // 3️⃣ Validate Telephone
//     //     if (extensionData?.mobile !== PBX_TELEPHONE) {
//     //       return res.status(400).json({
//     //         error:
//     //           "Telephone number does not match PBX extension record.",
//     //       });
//     //     }
//     //   } catch (err) {
//     //     console.error("❌ PBX Validation Error:", err?.response?.data || err);

//     //     return res.status(400).json({
//     //       error:
//     //         "Failed to validate extension/telephone with PBX device.",
//     //     });
//     //   }
//     // }

//     // Handle email change if newEmail is provided and different from current
//     let emailVerificationSent = false;
//     if (newEmail && newEmail.trim() !== "" && newEmail !== user.email) {
//       // Check if new email already exists for another user
//       const existingUser = await User.findOne({
//         email: newEmail,
//         _id: { $ne: userId },
//       });
//       if (existingUser) {
//         return res.status(400).json({
//           error: "This email address is already in use by another account.",
//         });
//       }

//       // Generate email change verification token
//       const emailChangeToken = crypto.randomBytes(32).toString("hex");

//       // Store pending email change data
//       user.pendingEmailChange = {
//         newEmail: newEmail,
//         token: emailChangeToken,
//         createdAt: new Date(),
//       };

//       // Send verification email
//       const verificationLink = `${FRONTEND_URL}/verify-email-change?token=${emailChangeToken}`;

//       try {
//         await sendEmailChangeVerification(
//           newEmail,
//           user.email,
//           `${user.firstname || ""} ${user.lastname || ""}`.trim() || user.email,
//           user._id.toString(),
//           verificationLink
//         );
//         emailVerificationSent = true;
//         console.log("✅ Email change verification sent to:", newEmail);
//       } catch (emailError) {
//         console.error("❌ Failed to send verification email:", emailError);
//         return res.status(500).json({
//           error: "Failed to send verification email. Please try again.",
//         });
//       }
//     }

//     // Allowed fields only
//     const updateData = {};

//     // 🆕 Assign PBX Details if device provided
//     if (assignedDeviceId) {
//       updateData.PBXDetails = {
//         PBX_BASE_URL: selectedDevice.PBX_BASE_URL,
//         PBX_USERNAME: selectedDevice.PBX_USERNAME,
//         PBX_PASSWORD: selectedDevice.PBX_PASSWORD,
//         PBX_SDK_ACCESS_ID: selectedDevice.PBX_SDK_ACCESS_ID,
//         PBX_SDK_ACCESS_KEY: selectedDevice.PBX_SDK_ACCESS_KEY,
//         PBX_USER_AGENT: selectedDevice.PBX_USER_AGENT,

//         assignedDeviceId: selectedDevice.deviceId,

//         PBX_EXTENSION_NUMBER,
//         PBX_EXTENSION_ID,
//         PBX_SIP_SECRET,
//         PBX_TELEPHONE,
//       };
//     }

//     // Determine if the request intends to activate the extension status.
//     // Accept either boolean true or string 'active' as activation intent.
//     const isActivating =
//       status === true || status === "active" || status === "Active";

//     // If activation is requested, require both fields to be provided and non-empty.
//     if (isActivating) {
//       const missing = [];
//       if (!extensionNumber || String(extensionNumber).trim() === "")
//         missing.push("Extension Number");
//       if (!telephone || String(telephone).trim() === "")
//         missing.push("Telephone");

//       if (missing.length > 0) {
//         return res.status(400).json({
//           error:
//             "To activate extension status, the following fields are required: " +
//             missing.join(", ") +
//             ".",
//         });
//       }
//     }

//     if (extensionNumber !== undefined)
//       updateData.extensionNumber = extensionNumber;
//     if (telephone !== undefined) updateData.telephone = telephone;

//     if (status !== undefined)
//       updateData.extensionStatus = isActivating ? true : false;

//     // Add pending email change to update data if it exists
//     if (user.pendingEmailChange) {
//       updateData.pendingEmailChange = user.pendingEmailChange;
//     }

//     // Update in DB
//     const updatedUser = await User.findByIdAndUpdate(
//       userId,
//       { $set: updateData },
//       { new: true }
//     ).select(
//       "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret extensionStatus accountStatus userInfo.companyName"
//     );

//     res.status(200).json({
//       status: "success",
//       message: "User updated successfully",
//       emailVerificationSent: emailVerificationSent,
//       updatedUser,
//     });
//   } catch (error) {
//     console.error("❌ Error updating user:", error);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// };

exports.editCompanyAdminAndAgent = async (req, res) => {
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
      console.log(
        "Assigning device to Company Admin:",
        assignedDeviceId
      );

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
      console.log("Assigning device to Agent User");

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

      console.log("Selected device for PBX details assignment:", selectedDevice);

      const accessToken = await getDeviceToken(
        selectedDevice.deviceId.toString(),
        "pbx"
      );

      console.log("Access token for PBX API calls:", accessToken);

      // 🔍 Extension fetch
      const extensionValidation = await axios.get(
        `${selectedDevice.PBX_BASE_URL}/extension/list?access_token=${accessToken}`
      );

      console.log(
        "Extension validation response:",
        extensionValidation.data
      );

      const extensionList =
        extensionValidation?.data?.data;

      console.log("Extension list from PBX:", extensionList);

      if (!extensionList || extensionList.length === 0) {
        return res.status(400).json({
          error: "No extensions found in PBX.",
        });
      }

      // ======================================================
      // 1️⃣ FIND PROPER EXTENSION FIRST
      // ======================================================

      const extensionData = extensionList.find(
        (ext) =>
          ext.number?.toString() ===
          PBX_EXTENSION_NUMBER?.toString()
      );

      console.log(`Looking for extension ${PBX_EXTENSION_NUMBER} in PBX extension list...`);
      console.log("Extension data found:", extensionData);

      if (!extensionData) {
        return res.status(400).json({
          error: `Extension ${PBX_EXTENSION_NUMBER} not found in PBX.`,
        });
      }

      console.log(
        "Matched Extension Data:",
        extensionData
      );

      // ======================================================
      // 📞 TELEPHONE VALIDATION (3 FORMAT MATCH)
      // ======================================================

      // 📞 Normalize telephone numbers
      const normalizePhoneVariants = (phone) => {
        if (!phone) return [];

        let cleaned = phone.toString().replace(/\D/g, "");

        const variants = new Set();

        // Original
        variants.add(cleaned);

        // Remove leading 0
        if (cleaned.startsWith("0")) {
          variants.add(cleaned.substring(1));
        }

        // Last 10 digits (remove country code)
        if (cleaned.length > 10) {
          variants.add(cleaned.slice(-10));
        }

        // Add 0 prefix variant
        if (cleaned.length >= 9) {
          variants.add("0" + cleaned.slice(-9));
        }

        return Array.from(variants);
      };

      const pbxMobile = extensionData.mobile_number;
      const reqMobile = PBX_TELEPHONE;

      console.log("PBX Mobile:", pbxMobile);
      console.log("Request Mobile:", reqMobile);

      const pbxVariants =
        normalizePhoneVariants(pbxMobile);
      const reqVariants =
        normalizePhoneVariants(reqMobile);

      console.log("PBX Variants:", pbxVariants);
      console.log("Request Variants:", reqVariants);

      // Match check
      const isMatch = pbxVariants.some((v) =>
        reqVariants.includes(v)
      );

      if (!isMatch) {
        return res.status(400).json({
          error:
            "Telephone number does not match PBX extension record.",
        });
      }

      console.log("✅ Telephone matched successfully");

      console.log("Assigning PBX details from device:", selectedDevice);
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
    console.error(
      "❌ Error updating user:",
      error
    );
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

// exports.updateMultipleYeastarUsersBySuperAdmin = async (req, res) => {
//   try {
//     const superAdminId = req.user._id;
//     const { users = [] } = req.body;

//     // 1️⃣ Super Admin Check
//     const superAdmin = await User.findById(superAdminId);

//     if (!superAdmin || superAdmin.role !== "superadmin") {
//       return res.status(403).json({
//         success: false,
//         message: "Only Super Admin can perform this action.",
//       });
//     }

//     if (!users.length) {
//       return res.status(400).json({
//         success: false,
//         message: "Users array is required.",
//       });
//     }

//     const updatedUsers = [];

//     // 2️⃣ Loop Users
//     for (const u of users) {
//       const {
//         userId,
//         deviceId,
//         PBX_EXTENSION_NUMBER,
//         PBX_EXTENSION_ID,
//         PBX_SIP_SECRET,
//         PBX_TELEPHONE,
//       } = u;

//       if (!userId || !deviceId) continue;

//       // 3️⃣ Find Target User
//       const targetUser = await User.findById(userId);
//       if (!targetUser) continue;

//       // 4️⃣ Find Device From SuperAdmin
//       const device = superAdmin.PBXDevices.find(
//         (d) => d.deviceId.toString() === deviceId.toString()
//       );

//       if (!device) {
//         updatedUsers.push({
//           userId,
//           status: "failed",
//           reason: "Device not found",
//         });
//         continue;
//       }

//       // 🔐 ===============================
//       // YEASTAR EXTENSION VALIDATION START
//       // 🔐 ===============================


//       // 2️⃣ Fetch Extension From PBX
//       let extensionData;

//       try {
//         let extRes = await axios.get(
//           `${device.PBX_BASE_URL}/extension/get?extension=${PBX_EXTENSION_NUMBER}`,
//           {
//             headers: {
//               "X-Access-Token": token,
//             },
//           }
//         );

//         // 🔁 If token expired → regenerate
//         if (extRes.data.errcode === 10004) {
//           console.log("⚠️ Token expired, regenerating...");

//           const tokenRes = await axios.post(
//             `${device.PBX_BASE_URL}/get_token`,
//             {
//               username: device.PBX_USERNAME,
//               password: device.PBX_PASSWORD,
//             },
//             {
//               headers: {
//                 "Content-Type": "application/json",
//                 "X-Access-ID": device.PBX_SDK_ACCESS_ID,
//                 "X-Access-Key": device.PBX_SDK_ACCESS_KEY,
//               },
//             }
//           );

//           token = tokenRes.data.access_token;

//           // Retry extension fetch
//           extRes = await axios.get(
//             `${device.PBX_BASE_URL}/extension/get?extension=${PBX_EXTENSION_NUMBER}`,
//             {
//               headers: {
//                 "X-Access-Token": token,
//               },
//             }
//           );
//         }

//         // ❌ Still error
//         if (extRes.data.errcode !== 0) {
//           updatedUsers.push({
//             userId,
//             status: "failed",
//             reason: extRes.data.errmsg,
//           });
//           continue;
//         }

//         extensionData = extRes.data.data;

//       } catch (err) {
//         updatedUsers.push({
//           userId,
//           status: "failed",
//           reason: "Extension fetch API error",
//         });
//         continue;
//       }


//       // 3️⃣ Validate Extension Details
//       // 3️⃣ Validate Extension Details
//       const isValid =
//         String(extensionData.id) === String(PBX_EXTENSION_ID) &&
//         String(extensionData.sip_password) === String(PBX_SIP_SECRET) &&
//         String(extensionData.mobile_number) === String(PBX_TELEPHONE);

//       if (!isValid) {
//         updatedUsers.push({
//           userId,
//           status: "failed",
//           reason: "Extension details mismatch",
//         });
//         continue;
//       }

//       // 🔐 ===============================
//       // YEASTAR EXTENSION VALIDATION END
//       // 🔐 ===============================

//       // 5️⃣ Ensure PBXDetails object
//       if (!targetUser.PBXDetails) {
//         targetUser.PBXDetails = {};
//       }

//       // 6️⃣ Assign PBX Device Creds
//       targetUser.PBXDetails.PBX_BASE_URL =
//         device.PBX_BASE_URL;

//       targetUser.PBXDetails.PBX_USERNAME =
//         device.PBX_USERNAME;

//       targetUser.PBXDetails.PBX_PASSWORD =
//         device.PBX_PASSWORD;

//       targetUser.PBXDetails.PBX_SDK_ACCESS_ID =
//         device.PBX_SDK_ACCESS_ID;

//       targetUser.PBXDetails.PBX_SDK_ACCESS_KEY =
//         device.PBX_SDK_ACCESS_KEY;

//       targetUser.PBXDetails.PBX_USER_AGENT =
//         device.PBX_USER_AGENT;

//       // 7️⃣ Assign Extension (Unique Per User)
//       targetUser.PBXDetails.PBX_EXTENSION_NUMBER =
//         PBX_EXTENSION_NUMBER;

//       targetUser.PBXDetails.PBX_EXTENSION_ID =
//         PBX_EXTENSION_ID;

//       targetUser.PBXDetails.PBX_SIP_SECRET =
//         PBX_SIP_SECRET;

//       targetUser.PBXDetails.PBX_TELEPHONE =
//         PBX_TELEPHONE;

//       targetUser.PBXDetails.assignedDeviceId =
//         deviceId;

//       // 8️⃣ Optional — mark provisioned
//       targetUser.extensionStatus = true;
//       targetUser.yeastarProvisionStatus = "done";

//       await targetUser.save();

//       updatedUsers.push({
//         userId,
//         deviceId,
//         extension: PBX_EXTENSION_NUMBER,
//         status: "success",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "PBX assigned to multiple users successfully.",
//       totalUpdated: updatedUsers.length,
//       data: updatedUsers,
//     });
//   } catch (error) {
//     console.error("❌ Multi PBX Assign Error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal Server Error",
//     });
//   }
// };

// exports.addYeastarDeviceBySuperAdmin = async (req, res) => {
//   try {
//     const superAdminId = req.user._id;

//     const {
//       deviceName,

//       PBX_BASE_URL,
//       PBX_USERNAME,
//       PBX_PASSWORD,
//       PBX_SDK_ACCESS_ID,
//       PBX_SDK_ACCESS_KEY,
//       PBX_USER_AGENT,
//     } = req.body;

//     // 1️⃣ Check Super Admin
//     const superAdmin = await User.findById(superAdminId);

//     if (!superAdmin || superAdmin.role !== "superadmin") {
//       return res.status(403).json({
//         success: false,
//         message: "Only Super Admin can add devices.",
//       });
//     }

//     // 2️⃣ Create Device Object
//     const newDevice = {
//       deviceName,

//       PBX_BASE_URL,
//       PBX_USERNAME,
//       PBX_PASSWORD,
//       PBX_SDK_ACCESS_ID,
//       PBX_SDK_ACCESS_KEY,
//       PBX_USER_AGENT,
//     };

//     // 3️⃣ Push into array
//     superAdmin.PBXDevices.push(newDevice);

//     await superAdmin.save();

//     return res.status(200).json({
//       success: true,
//       message: "Yeastar device added successfully.",
//       data: newDevice,
//     });
//   } catch (error) {
//     console.error("❌ Add Device Error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal Server Error",
//     });
//   }
// };

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
        const tokenRes = await axios.post(
          `${device.PBX_BASE_URL}/get_token`,
          {
            username: device.PBX_USERNAME,
            password: device.PBX_PASSWORD,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "X-Access-ID": device.PBX_SDK_ACCESS_ID,
              "X-Access-Key": device.PBX_SDK_ACCESS_KEY,
              "User-Agent": device.PBX_USER_AGENT || "Voycell-App",
            },
          }
        );

        token = tokenRes.data.access_token;
        console.log(`✅ Token generated for device ${deviceId}`);

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
        // 🔍 STEP 5 — Fetch Extension
        // =====================================================
        let extRes;

        try {
          extRes = await axios.get(
            `${device.PBX_BASE_URL}/extension/get?extension=${PBX_EXTENSION_NUMBER}`,
            {
              headers: {
                "X-Access-Token": token,
              },
            }
          );

          // 🔁 If token expired → regenerate ONCE
          if (extRes.data.errcode === 10004) {

            console.log("⚠️ Token expired → regenerating...");

            const tokenRes = await axios.post(
              `${device.PBX_BASE_URL}/get_token`,
              {
                username: device.PBX_USERNAME,
                password: device.PBX_PASSWORD,
              },
              {
                headers: {
                  "Content-Type": "application/json",
                  "X-Access-ID": device.PBX_SDK_ACCESS_ID,
                  "X-Access-Key": device.PBX_SDK_ACCESS_KEY,
                },
              }
            );

            token = tokenRes.data.access_token;

            // Retry extension API
            extRes = await axios.get(
              `${device.PBX_BASE_URL}/extension/get?extension=${PBX_EXTENSION_NUMBER}`,
              {
                headers: {
                  "X-Access-Token": token,
                },
              }
            );
          }

          // ❌ Still error
          if (extRes.data.errcode !== 0) {
            updatedUsers.push({
              userId,
              status: "failed",
              reason: extRes.data.errmsg,
            });
            continue;
          }

        } catch (err) {
          updatedUsers.push({
            userId,
            status: "failed",
            reason: "Extension fetch API error",
          });
          continue;
        }

        const extensionData = extRes.data.data;

        // =====================================================
        // 🔐 STEP 6 — Validate Extension
        // =====================================================
        const isValid =
          String(extensionData.id) === String(PBX_EXTENSION_ID) &&
          String(extensionData.sip_password) === String(PBX_SIP_SECRET) &&
          String(extensionData.mobile_number) === String(PBX_TELEPHONE);

        if (!isValid) {
          updatedUsers.push({
            userId,
            status: "failed",
            reason: "Extension details mismatch",
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
    console.error("❌ Multi PBX Assign Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// exports.addYeastarDeviceBySuperAdmin = async (req, res) => {
//   try {
//     const superAdminId = req.user._id;

//     const {
//       deviceName,
//       PBX_BASE_URL,
//       PBX_USERNAME,
//       PBX_PASSWORD,
//       PBX_SDK_ACCESS_ID,
//       PBX_SDK_ACCESS_KEY,
//       PBX_USER_AGENT,
//     } = req.body;

//     // 1️⃣ Check Super Admin
//     const superAdmin = await User.findById(superAdminId);

//     if (!superAdmin || superAdmin.role !== "superadmin") {
//       return res.status(403).json({
//         success: false,
//         message: "Only Super Admin can add devices.",
//       });
//     }

//     // 2️⃣ 🔐 Validate Yeastar Credentials
//     let tokenResponse;

//     try {
//       tokenResponse = await axios.post(
//         `${PBX_BASE_URL}/get_token`,
//         {
//           username: PBX_USERNAME,
//           password: PBX_PASSWORD,
//         },
//         {
//           headers: {
//             "Content-Type": "application/json",
//             "X-Access-ID": PBX_SDK_ACCESS_ID,
//             "X-Access-Key": PBX_SDK_ACCESS_KEY,
//             "User-Agent": PBX_USER_AGENT || "Voycell-App",
//           },
//           timeout: 10000,
//         }
//       );

//       console.log("✅ PBX Auth Success:", tokenResponse.data);

//     } catch (err) {
//       console.error("❌ PBX Auth Error:", err?.response?.data || err);

//       return res.status(400).json({
//         success: false,
//         message: "Invalid PBX credentials or PBX unreachable.",
//       });
//     }

//     // If token not received
//     if (!tokenResponse?.data?.access_token) {
//       return res.status(400).json({
//         success: false,
//         message: "Failed to authenticate with PBX.",
//       });
//     }

//     // 3️⃣ Create Device Object
//     const newDevice = {
//       deviceName,
//       PBX_BASE_URL,
//       PBX_USERNAME,
//       PBX_PASSWORD,
//       PBX_SDK_ACCESS_ID,
//       PBX_SDK_ACCESS_KEY,
//       PBX_USER_AGENT,
//     };

//     // 4️⃣ Save Device
//     superAdmin.PBXDevices.push(newDevice);
//     await superAdmin.save();

//     return res.status(200).json({
//       success: true,
//       message: "PBX device validated & added successfully.",
//       data: newDevice,
//     });
//   } catch (error) {
//     console.error("❌ Add Device Error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal Server Error",
//     });
//   }
// };

// const axios = require("axios");
// const { getDeviceToken } = require("../services/token.service");

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

      console.log("✅ PBX validated");
    } catch (err) {
      console.error(
        "❌ PBX Auth Error:",
        err?.response?.data || err
      );

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

      console.log("✅ SDK validated");
    } catch (err) {
      console.error(
        "❌ SDK Auth Error:",
        err?.response?.data || err
      );

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

    console.log(`Found ${affectedUsers.length} users assigned to the deleted device. Resetting their PBX details...`
    );
    console.log("Affected user IDs:", affectedUsers.map(u => u._id.toString()));

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
    console.error("❌ Delete Device Error:", error);
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
    console.error("❌ Get Device By ID Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};