const User = require("../models/userModel");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");

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

    // Prevent deactivation of superadmin
    if (user.role === "superadmin") {
      return res.status(403).json({
        status: "error",
        message: "Superadmin cannot be deactivated",
      });
    }

    // Step 2: Handle companyAdmin case
    if (user.role === "companyAdmin") {
      // Deactivate the company admin
      await User.findByIdAndUpdate(userId, { accountStatus: "deactivated" });

      // Deactivate all users created by this company admin
      await User.updateMany(
        { createdByWhichCompanyAdmin: userId },
        { accountStatus: "deactivated" }
      );

      return res.status(200).json({
        status: "success",
        message:
          "Company admin and all associated agents deactivated",
      });
    }

    // Step 3: Handle normal user case
    // if (user.role === "user") {
    //   const userToDeactivate = await User.findByIdAndUpdate(userId).select("createdByWhichCompanyAdmin");

    //   // await User.findByIdAndUpdate(userId, { accountStatus: "deactivated" });


    //   return res.status(200).json({
    //     status: "success",
    //     message: "Agent account deactivated",
    //   });
    // }

    // Step 3: Handle normal user case
    if (user.role === "user") {

      // 1️⃣ Deactivate user
      await User.findByIdAndUpdate(userId, {
        accountStatus: "deactivated",
      });

      // 2️⃣ Get Company Admin ID
      const companyAdminId = user.createdByWhichCompanyAdmin;

      // Safety check
      if (companyAdminId) {

        // 3️⃣ Reassign Contacts
        await Contact.updateMany(
          { createdBy: userId },
          { createdBy: companyAdminId }
        );

        // 4️⃣ Reassign Leads
        await Lead.updateMany(
          { createdBy: userId },
          { createdBy: companyAdminId }
        );
      }

      return res.status(200).json({
        status: "success",
        message:
          "Agent account deactivated and data reassigned to company admin",
      });
    }

    // Fallback case (shouldn't occur normally)
    return res.status(400).json({
      status: "error",
      message: "Invalid user role for deactivation",
    });
  } catch (error) {
    console.error("Error deactivating user:", error);
    return res.status(500).json({
      status: "error",
      message: "An error occurred while deactivating the account",
    });
  }
};

const suspendUser = async (req, res) => {
  try {
    const userId = req.body.user_id;

    // Step 1: Fetch the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // Prevent deactivation of superadmin
    if (user.role === "superadmin") {
      return res.status(403).json({
        status: "error",
        message: "Superadmin cannot be suspended",
      });
    }

    // Step 2: Handle companyAdmin case
    if (user.role === "companyAdmin") {
      // Deactivate the company admin
      await User.findByIdAndUpdate(userId, { accountStatus: "suspended" });

      // Deactivate all users created by this company admin
      await User.updateMany(
        { createdByWhichCompanyAdmin: userId },
        { accountStatus: "suspended" }
      );

      return res.status(200).json({
        status: "success",
        message:
          "Company admin and all associated agents deactivated",
      });
    }

    // Step 3: Handle normal user case
    // if (user.role === "user") {
    //   await User.findByIdAndUpdate(userId, { accountStatus: "suspended" });

    //   return res.status(200).json({
    //     status: "success",
    //     message: "Agent account suspended",
    //   });
    // }

    if (user.role === "user") {

      // 1️⃣ Suspend user
      await User.findByIdAndUpdate(userId, {
        accountStatus: "suspended",
      });

      // 2️⃣ Get Company Admin ID
      const companyAdminId = user.createdByWhichCompanyAdmin;

      if (companyAdminId) {

        // 3️⃣ Reassign Contacts
        await Contact.updateMany(
          { createdBy: userId },
          { createdBy: companyAdminId }
        );

        // 4️⃣ Reassign Leads
        await Lead.updateMany(
          { createdBy: userId },
          { createdBy: companyAdminId }
        );
      }

      return res.status(200).json({
        status: "success",
        message:
          "Agent account suspended and data reassigned to company admin",
      });
    }

    // Fallback case (shouldn't occur normally)
    return res.status(400).json({
      status: "error",
      message: "Invalid user role for deactivation",
    });
  } catch (error) {
    console.error("Error deactivating user:", error);
    return res.status(500).json({
      status: "error",
      message: "An error occurred while deactivating the account",
    });
  }
};

const activateUser = async (req, res) => {
  try {
    const userId = req.body.user_id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.role === "companyAdmin") {
      await User.findByIdAndUpdate(userId, { accountStatus: "active" });
      await User.updateMany(
        { createdByWhichCompanyAdmin: userId },
        { accountStatus: "active" }
      );
      return res.status(200).json({
        status: "success",
        message:
          "Company admin and all associated agents reactivated",
      });
    }

    if (user.role === "user") {
      await User.findByIdAndUpdate(userId, { accountStatus: "active" });
      return res.status(200).json({
        status: "success",
        message: "User account reactivated",
      });
    }

    return res
      .status(403)
      .json({ message: "Superadmin cannot be reactivated manually" });
  } catch (error) {
    console.error("Error activating user:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};


module.exports = { deleteUser, activateUser, suspendUser };
