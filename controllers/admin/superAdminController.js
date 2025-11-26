const User = require("../../models/userModel");

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
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret extensionStatus"
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
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret createdByWhichCompanyAdmin extensionStatus"
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
        "_id firstname lastname email createdAt extensionNumber sipSecret telephone phonenumbers extensionStatus"
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
        "_id firstname lastname email createdAt extensionNumber telephone phonenumbers sipSecret createdByWhichCompanyAdmin extensionStatus"
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
    const { userId, extensionNumber, telephone, sipSecret, status } = req.body;

    console.log(
      "Received body:",
      userId,
      extensionNumber,
      telephone,
      sipSecret,
      status
    );

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // Fetch the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Allowed fields only
    const updateData = {};

    // Determine if the request intends to activate the extension status.
    // Accept either boolean true or string 'active' as activation intent.
    const isActivating =
      status === true || status === "active" || status === "Active";

    // If activation is requested, require all three fields to be provided and non-empty.
    if (isActivating) {
      const missing = [];
      if (!extensionNumber || String(extensionNumber).trim() === "")
        missing.push("Extension Number");
      if (!telephone || String(telephone).trim() === "")
        missing.push("Telephone");
      if (!sipSecret || String(sipSecret).trim() === "")
        missing.push("SIP Secret");

      if (missing.length > 0) {
        return res.status(400).json({
          error:
            "To activate extension status, the following fields are required: " +
            missing.join(", ") +
            ".",
        });
      }
    }

    // SIP Secret complexity validation: must contain at least one digit, one lowercase and one uppercase letter
    const sip = sipSecret || (user && user.sipSecret) || "";
    if (sip) {
      const sipRegex = /(?=.*\d)(?=.*[a-z])(?=.*[A-Z])/;
      if (!sipRegex.test(String(sip))) {
        return res.status(400).json({
          error:
            "SIP Secret must contain at least one lowercase letter, one uppercase letter and one number.",
        });
      }
    }

    if (extensionNumber !== undefined)
      updateData.extensionNumber = extensionNumber;
    if (telephone !== undefined) updateData.telephone = telephone;
    if (sipSecret !== undefined) updateData.sipSecret = sipSecret;

    if (status !== undefined)
      updateData.extensionStatus = isActivating ? true : false;

    // Update in DB
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    ).select(
      "_id firstname lastname email role extensionNumber telephone sipSecret extensionStatus"
    );

    res.status(200).json({
      status: "success",
      message: "User updated successfully",
      updatedUser,
    });
  } catch (error) {
    console.error("❌ Error updating user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
