// voycellcallcenter-backend/controllers/powerDialerCampaignController.js
const PowerDialerCampaign = require("../models/PowerDialerCampaign");
const PowerDialerList = require("../models/PowerDialerList");

const getCompanyId = (user) => {
  if (user.role === "companyAdmin") return user._id;
  if (user.role === "user") return user.createdByWhichCompanyAdmin;
  return null;
};

// POST /api/power-dialer/campaigns
const createCampaign = async (req, res) => {
  try {
    const {
      list_id, name, description, allocation, assignees,
      from_number, from_number_type, call_dispositions,
      timezone_dialing, auto_machine_detection, auto_voicemail_drop,
      attempt_per_contact,
    } = req.body;
    const company_id = getCompanyId(req.user);

    if (!list_id || !name) {
      return res.status(400).json({ status: "error", message: "list_id and name required" });
    }

    const list = await PowerDialerList.findOne({ _id: list_id, company_id });
    if (!list) return res.status(404).json({ status: "error", message: "List not found" });

    const campaign = await PowerDialerCampaign.create({
      company_id,
      list_id,
      name,
      description: description || "",
      allocation: allocation || "users",
      assignees: assignees || [],
      from_number: from_number || "",
      from_number_type: from_number_type || "number",
      call_dispositions: call_dispositions || [],
      timezone_dialing: !!timezone_dialing,
      auto_machine_detection: !!auto_machine_detection,
      auto_voicemail_drop: !!auto_voicemail_drop,
      attempt_per_contact: attempt_per_contact || 1,
      created_by: req.user._id,
    });

    return res.status(201).json({ status: "success", data: campaign });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// GET /api/power-dialer/campaigns
const getCampaigns = async (req, res) => {
  try {
    const company_id = getCompanyId(req.user);
    let query = { company_id };
    if (req.user.role === "user") {
      query.assignees = req.user._id;
    }

    const campaigns = await PowerDialerCampaign.find(query)
      .populate("list_id", "name total_contacts")
      .populate("created_by", "firstname lastname")
      .sort({ created_at: -1 });

    return res.status(200).json({ status: "success", data: campaigns });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// PUT /api/power-dialer/campaigns/:id
const updateCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = getCompanyId(req.user);

    const campaign = await PowerDialerCampaign.findOne({ _id: id, company_id });
    if (!campaign) return res.status(404).json({ status: "error", message: "Campaign not found" });

    const allowed = [
      "name", "description", "allocation", "assignees", "from_number",
      "from_number_type", "call_dispositions", "timezone_dialing",
      "auto_machine_detection", "auto_voicemail_drop", "attempt_per_contact",
    ];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) campaign[field] = req.body[field];
    });
    campaign.updated_at = new Date();
    await campaign.save();

    return res.status(200).json({ status: "success", data: campaign });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// DELETE /api/power-dialer/campaigns/:id
const deleteCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = getCompanyId(req.user);

    const campaign = await PowerDialerCampaign.findOne({ _id: id, company_id });
    if (!campaign) return res.status(404).json({ status: "error", message: "Campaign not found" });

    await PowerDialerCampaign.findByIdAndDelete(id);
    return res.status(200).json({ status: "success", message: "Campaign deleted" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// PUT /api/power-dialer/campaigns/:id/status
// Body: { status: 'active'|'paused'|'stopped'|'completed' }
const updateCampaignStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const company_id = getCompanyId(req.user);

    if (!["active", "paused", "stopped", "completed"].includes(status)) {
      return res.status(400).json({ status: "error", message: "Invalid status" });
    }

    const campaign = await PowerDialerCampaign.findOne({ _id: id, company_id });
    if (!campaign) return res.status(404).json({ status: "error", message: "Campaign not found" });

    campaign.status = status;
    campaign.updated_at = new Date();
    await campaign.save();

    return res.status(200).json({ status: "success", data: campaign });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

module.exports = { createCampaign, getCampaigns, updateCampaign, deleteCampaign, updateCampaignStatus };
