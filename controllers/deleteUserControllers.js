const User = require("../models/userModel");
const Contact = require("../models/contactModel");

const deleteUser = async (req, res) => {
  try {
    const userId = req.user._id;

    // Step 1: Fetch the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // If companyAdmin, delete all their users and contacts
    if (user.role === "companyAdmin") {
      // 1a. Find all users created by this company admin
      const users = await User.find({ createdByWhichCompanyAdmin: userId });

      const userIds = users.map(u => u._id);

      // 1b. Delete all contacts created by these users
      await Contact.deleteMany({ createdBy: { $in: userIds } });

      // 1c. Delete all these users
      await User.deleteMany({ _id: { $in: userIds } });

      // 1d. Delete all contacts created by the company admin
      await Contact.deleteMany({ createdBy: userId });

      // 1e. Delete the company admin
      await User.findByIdAndDelete(userId);

      return res.status(200).json({
        status: "success",
        message: "Company admin, all associated users, and contacts deleted successfully",
      });
    }

    // If normal user, delete only their account and contacts
    if (user.role === "user") {
      const userEmail = user.email?.toLowerCase()?.trim();
      const userPhones = user.phonenumbers?.map(p => ({
        countryCode: p.countryCode?.trim(),
        number: p.number?.trim(),
      })) || [];

      // Delete contacts created by this user
      await Contact.deleteMany({ createdBy: userId });

      // Delete references in other users' contacts if email/phone match
      if (userEmail || userPhones.length) {
        const phoneConditions = userPhones.map(p => ({
          "phonenumbers.countryCode": p.countryCode,
          "phonenumbers.number": p.number,
        }));

        const deleteQuery = {
          createdBy: { $ne: userId },
          $or: [],
        };

        if (userEmail) deleteQuery.$or.push({ email: userEmail });
        if (phoneConditions.length) deleteQuery.$or.push({ $or: phoneConditions });

        if (deleteQuery.$or.length > 0) {
          await Contact.deleteMany(deleteQuery);
        }
      }

      // Delete the user
      await User.findByIdAndDelete(userId);

      return res.status(200).json({
        status: "success",
        message: "User and all associated contacts deleted successfully",
      });
    }

    // For superadmin or unknown role, do nothing
    return res.status(403).json({
      status: "error",
      message: "Role not authorized for deletion",
    });
  } catch (error) {
    console.error("Error deleting user and references:", error);
    return res.status(500).json({
      status: "error",
      message: "Error deleting user and associated data",
    });
  }
};

module.exports = { deleteUser };
