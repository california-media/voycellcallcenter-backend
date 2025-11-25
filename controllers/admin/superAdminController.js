// controllers/superAdminController.js

const User = require("../../models/userModel");

exports.getAllCompanyAdminsWithAgents = async (req, res) => {
  try {
    // Check if super admin
    // if (req.user.role !== "superadmin") {
    //   return res.status(403).json({ message: "Access denied. Superadmin only." });
    // }

    // 1️⃣ Fetch all company admins
    const companyAdmins = await User.find({ role: "companyAdmin" })
      .select("_id firstname lastname email createdAt extensionNumber sipSecret telephone phonenumbers ")
      .lean();

    // 2️⃣ Fetch all users (agents)
    const agents = await User.find({ role: "user" })
      .select("_id firstname lastname email createdByWhichCompanyAdmin createdAt extensionNumber sipSecret phonenumbers telephone ")
      .lean();

    // 3️⃣ Group agents under their respective admin
    const adminWithAgents = companyAdmins.map((admin) => {
      const adminAgents = agents.filter(
        (agent) =>
          agent.createdByWhichCompanyAdmin &&
          agent.createdByWhichCompanyAdmin.toString() === admin._id.toString()
      );

      return {
        adminId: admin._id,
        firstname: admin.firstname,
        lastname: admin.lastname,
        email: admin.email,
        createdAt: admin.createdAt,
        popupSettings: admin.popupSettings,
        agents: adminAgents,
      };
    });

    res.status(200).json({
      totalAdmins: companyAdmins.length,
      data: adminWithAgents,
    });
  } catch (error) {
    console.error("❌ Error fetching admins + agents:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
