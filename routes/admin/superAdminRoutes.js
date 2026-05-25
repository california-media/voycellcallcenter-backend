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
  getCompanyBillingDetails,
  deleteCompanyBySuperAdmin,
  createCompanyAdmin,
  createAgentBySuperAdmin,
  resetUserPassword,
  updateUserVerification,
  updateUserContact,
  generateLoginLink,
  adjustBalance,
  getCompanyExtensions,
  setCompanyExtensions,
  setCallerPreferences,
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

// Company billing details
router.get("/companies/:userId/billing", getCompanyBillingDetails);

// Permanently delete a deactivated company (SuperAdmin only)
router.post("/deleteCompany", deleteCompanyBySuperAdmin);

// User management (SuperAdmin)
router.post("/createCompanyAdmin", createCompanyAdmin);
router.post("/createAgent", createAgentBySuperAdmin);
router.post("/resetUserPassword", resetUserPassword);
router.put("/updateUserVerification", updateUserVerification);
router.put("/updateUserContact", updateUserContact);
router.post("/generateLoginLink", generateLoginLink);
router.put("/adjustBalance", adjustBalance);

// Company extension management (SuperAdmin)
router.get("/companies/:userId/extensions", getCompanyExtensions);
router.put("/companies/:userId/extensions", setCompanyExtensions);
router.put("/companies/:userId/caller-preferences", setCallerPreferences);

// SuperAdmin WhatsApp campaigns
const {
  sendAdminCampaign,
  getAdminCampaigns,
  getAdminCampaignById,
} = require("../../controllers/admin/adminWhatsappController");

router.post("/whatsapp/send-campaign", sendAdminCampaign);
router.post("/whatsapp/campaigns", getAdminCampaigns);
router.post("/whatsapp/campaignsById", getAdminCampaignById);

// SuperAdmin billing
const {
  getAllCompaniesBilling,
  getCompanyInvoices,
} = require("../../controllers/admin/adminBillingController");

router.post("/billing", getAllCompaniesBilling);
router.post("/billing/invoices", getCompanyInvoices);

module.exports = router;
