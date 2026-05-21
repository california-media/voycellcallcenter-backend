// voycellcallcenter-backend/controllers/powerDialerCampaignController.js
const mongoose = require("mongoose");
const PowerDialerCampaign = require("../models/PowerDialerCampaign");
const PowerDialerList = require("../models/PowerDialerList");
const PowerDialerContact = require("../models/PowerDialerContact");
const Contact = require("../models/contactModel");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

// Transfer all contacts in a campaign's list to each assignee's Contact database
// and remove those phone numbers from the company admin's Contact records.
const transferContactsToAssignees = async (campaign, assigneeIds) => {
  if (!assigneeIds || assigneeIds.length === 0) return;

  const dialerContacts = await PowerDialerContact.find({ list_id: campaign.list_id }).lean();
  if (dialerContacts.length === 0) return;

  const phones = dialerContacts.map((c) => c.phone).filter(Boolean);

  for (const agentId of assigneeIds) {
    for (const dc of dialerContacts) {
      const rawPhone = String(dc.phone || "").replace(/\s/g, "");
      if (!rawPhone) continue;

      let phoneObj = { countryCode: "", number: "" };
      const parsed = parsePhoneNumberFromString(`+${rawPhone}`) || parsePhoneNumberFromString(rawPhone);
      if (parsed && parsed.nationalNumber) {
        phoneObj.countryCode = String(parsed.countryCallingCode || "");
        phoneObj.number = String(parsed.nationalNumber);
      } else {
        phoneObj.number = rawPhone.replace(/\D/g, "");
      }
      if (!phoneObj.number) continue;

      const nameParts = (dc.name || "").split(" ");
      const firstname = nameParts[0] || "";
      const lastname = nameParts.slice(1).join(" ") || "";

      const id = new mongoose.Types.ObjectId();
      await Contact.findOneAndUpdate(
        { createdBy: agentId, "phoneNumbers.number": phoneObj.number },
        {
          $setOnInsert: {
            _id: id,
            contact_id: id,
            firstname,
            lastname,
            phoneNumbers: [phoneObj],
            emailAddresses: [],
            notes: dc.notes || "",
            isLead: false,
            activities: [{
              action: "contact_created",
              type: "import",
              title: "Imported via Power Dialer Campaign",
              description: `Campaign: ${campaign.name}`,
              timestamp: new Date(),
            }],
            createdBy: agentId,
          },
        },
        { upsert: true }
      );
    }
  }

  // Remove those phone numbers from company admin's Contact records
  const allNumbers = dialerContacts
    .map((dc) => {
      const parsed = parsePhoneNumberFromString(`+${dc.phone}`) || parsePhoneNumberFromString(dc.phone);
      return parsed?.nationalNumber ? String(parsed.nationalNumber) : dc.phone.replace(/\D/g, "");
    })
    .filter(Boolean);

  await Contact.deleteMany({
    createdBy: campaign.company_id,
    "phoneNumbers.number": { $in: allNumbers },
  });
};

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

    if (assignees && assignees.length > 0) {
      await transferContactsToAssignees(campaign, assignees);
    }

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

    const prevAssignees = (campaign.assignees || []).map(String);

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

    // Transfer contacts only to newly added assignees
    if (req.body.assignees) {
      const newAssignees = (req.body.assignees || []).map(String);
      const addedAssignees = newAssignees.filter((id) => !prevAssignees.includes(id));
      if (addedAssignees.length > 0) {
        await transferContactsToAssignees(campaign, addedAssignees);
      }
    }

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
