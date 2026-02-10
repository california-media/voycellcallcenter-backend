// routes/superAdminRoutes.js
const express = require("express");
const router = express.Router();
const {
  getAgentDetails,
  getCompanyAdminDetails,
  getAgentsOfCompanyAdmin,
  getAllCompanyAdmins,
  editCompanyAdminAndAgent,
  updateMultipleYeastarUsersBySuperAdmin,
  addYeastarDeviceBySuperAdmin,
  updateYeastarDeviceBySuperAdmin,
  deleteYeastarDeviceBySuperAdmin,
  getAllYeastarDevicesBySuperAdmin,
  getYeastarDeviceById,
  getAllCompanyAdminsByDevice,
  getAgentsOfCompanyAdminByDevice,
} = require("../../controllers/admin/superAdminController");

// Super Admin only
router.post("/allCompanyAdmin", getAllCompanyAdmins);

router.post("/companyAdminDetailsById", getCompanyAdminDetails);

router.post("/allAgentsOfCompanyAdmin", getAgentsOfCompanyAdmin);

router.post("/getAllCompanyAdminsByPBXDevice", getAllCompanyAdminsByDevice);

router.post("/getAgentsOfCompanyAdminByPBXDevice", getAgentsOfCompanyAdminByDevice);

router.post("/agentDetailsById", getAgentDetails);

router.put("/editCompanyAdminAndAgent", editCompanyAdminAndAgent);

router.post("/updateMultipleYeastarUsers", updateMultipleYeastarUsersBySuperAdmin);

router.post("/addPBXDevice", addYeastarDeviceBySuperAdmin);

router.put("/updatePBXDevice", updateYeastarDeviceBySuperAdmin);

router.delete("/deletePBXDevice", deleteYeastarDeviceBySuperAdmin);

router.get("/getAllPBXDevices", getAllYeastarDevicesBySuperAdmin);

router.get("/getPBXDeviceById", getYeastarDeviceById);

module.exports = router;
