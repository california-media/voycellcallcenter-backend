// voycellcallcenter-backend/controllers/powerDialerListController.js
const mongoose = require("mongoose");
const User = require("../models/userModel");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const PowerDialerList = require("../models/PowerDialerList");
const PowerDialerContact = require("../models/PowerDialerContact");

const getCompanyId = (user) => {
  if (user.role === "companyAdmin") return user._id;
  if (user.role === "user") return user.createdByWhichCompanyAdmin;
  return null;
};

// POST /api/power-dialer/lists
// Body: { name, source: 'csv'|'group', contacts?: [{name, phone}], group_ids?: [string] }
const createList = async (req, res) => {
  try {
    const { name, source, contacts, group_ids } = req.body;
    const company_id = getCompanyId(req.user);

    if (!name || !name.trim()) {
      return res.status(400).json({ status: "error", message: "List name required" });
    }

    const list = await PowerDialerList.create({
      company_id,
      name: name.trim(),
      source: source || "csv",
      created_by: req.user._id,
    });

    let contactDocs = [];

    if (source === "csv" && Array.isArray(contacts) && contacts.length > 0) {
      // Build company-wide existing phone set to avoid duplicates in Contact model
      const agents = await User.find({ createdByWhichCompanyAdmin: company_id, role: "user" }).select("_id");
      const allUserIds = [company_id, ...agents.map((a) => a._id)];
      const existingContacts = await Contact.find({ createdBy: { $in: allUserIds } }, "phoneNumbers").lean();
      const existingPhones = new Set();
      for (const ec of existingContacts) {
        for (const p of ec.phoneNumbers || []) {
          if (!p.number) continue;
          const d = String(p.number).replace(/\D/g, "");
          existingPhones.add(d);
          if (p.countryCode) existingPhones.add(`${p.countryCode}${d}`);
        }
      }

      const batchNewPhones = new Set();
      const contactBulkOps = [];

      contacts.forEach((c, i) => {
        const rawPhone = String(c.phone || "").replace(/\s/g, "");
        if (!rawPhone) return;

        contactDocs.push({
          list_id: list._id,
          company_id,
          name: String(c.name || `${c.firstname || ""} ${c.lastname || ""}`.trim() || "").trim(),
          phone: rawPhone,
          email: String(c.email || ""),
          notes: String(c.notes || ""),
          status: "pending",
          order: i,
        });

        // Parse phone for Contact model
        let phoneObj = { countryCode: "971", number: "" };
        const parsed = parsePhoneNumberFromString(`+${rawPhone}`) || parsePhoneNumberFromString(rawPhone);
        if (parsed && parsed.nationalNumber) {
          phoneObj.countryCode = String(parsed.countryCallingCode || "971");
          phoneObj.number = String(parsed.nationalNumber);
        } else {
          phoneObj.number = rawPhone.replace(/\D/g, "");
        }
        if (!phoneObj.number) return;

        const digits = phoneObj.number;
        const fullPhone = `${phoneObj.countryCode}${digits}`;
        if (existingPhones.has(digits) || existingPhones.has(fullPhone) || batchNewPhones.has(digits) || batchNewPhones.has(fullPhone)) return;

        batchNewPhones.add(digits);
        batchNewPhones.add(fullPhone);

        const firstname = String(c.firstname || (c.name ? c.name.split(" ")[0] : "") || "").trim();
        const lastname  = String(c.lastname  || (c.name ? c.name.split(" ").slice(1).join(" ") : "") || "").trim();
        const id = new mongoose.Types.ObjectId();
        const noteText = String(c.notes || "").trim();
        contactBulkOps.push({
          insertOne: {
            document: {
              _id: id,
              contact_id: id,
              firstname,
              lastname,
              phoneNumbers: [phoneObj],
              emailAddresses: c.email ? [String(c.email).toLowerCase().trim()] : [],
              notes: noteText,
              status: "",
              isLead: false,
              tasks: noteText ? [{
                task_id: new mongoose.Types.ObjectId(),
                taskDescription: noteText,
                taskDueDate: null,
                taskDueTime: null,
                taskIsCompleted: false,
                createdAt: new Date(),
              }] : [],
              activities: [{ action: "contact_created", type: "contact", title: "Contact Imported via Power Dialer", description: `${firstname} ${lastname}`.trim() }],
              createdBy: req.user._id,
            },
          },
        });
      });

      if (contactBulkOps.length > 0) {
        await Contact.bulkWrite(contactBulkOps, { ordered: false });
      }
    } else if (source === "group" && Array.isArray(group_ids) && group_ids.length > 0) {
      const adminId = company_id;
      const tagObjectIds = group_ids.map((id) => new mongoose.Types.ObjectId(id));

      const agents = await User.find({
        createdByWhichCompanyAdmin: adminId,
        role: "user",
      }).select("_id");
      const allUserIds = [adminId, ...agents.map((a) => a._id)];

      const [contactsWithTags, leadsWithTags] = await Promise.all([
        Contact.find({
          createdBy: { $in: allUserIds },
          "tags.tag_id": { $in: tagObjectIds },
        }).select("firstname lastname phoneNumbers"),
        Lead.find({
          createdBy: { $in: allUserIds },
          "tags.tag_id": { $in: tagObjectIds },
        }).select("firstname lastname phoneNumbers"),
      ]);

      let order = 0;
      for (const c of [...contactsWithTags, ...leadsWithTags]) {
        for (const ph of c.phoneNumbers || []) {
          if (ph.number) {
            contactDocs.push({
              list_id: list._id,
              company_id,
              name: `${c.firstname || ""} ${c.lastname || ""}`.trim(),
              phone: `${ph.countryCode || ""}${ph.number}`,
              status: "pending",
              order: order++,
            });
          }
        }
      }
    }

    if (contactDocs.length > 0) {
      await PowerDialerContact.insertMany(contactDocs);
    }

    await PowerDialerList.findByIdAndUpdate(list._id, {
      total_contacts: contactDocs.length,
    });

    return res.status(201).json({
      status: "success",
      message: "List created",
      data: { ...list.toObject(), total_contacts: contactDocs.length },
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// GET /api/power-dialer/lists
const getLists = async (req, res) => {
  try {
    const company_id = getCompanyId(req.user);

    let query = { company_id };
    if (req.user.role === "user") {
      query = {
        company_id,
        $or: [{ assigned_to: req.user._id }, { assigned_to: { $size: 0 } }],
      };
    }

    const lists = await PowerDialerList.find(query)
      .populate("assigned_to", "firstname lastname")
      .sort({ created_at: -1 });

    return res.status(200).json({ status: "success", data: lists });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// DELETE /api/power-dialer/lists/:id
const deleteList = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = getCompanyId(req.user);

    const list = await PowerDialerList.findOne({ _id: id, company_id });
    if (!list) return res.status(404).json({ status: "error", message: "List not found" });

    await PowerDialerContact.deleteMany({ list_id: id });
    await PowerDialerList.findByIdAndDelete(id);

    return res.status(200).json({ status: "success", message: "List deleted" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// POST /api/power-dialer/lists/:id/assign  — companyAdmin only
// Body: { agent_ids: [string] }
const assignList = async (req, res) => {
  try {
    const { id } = req.params;
    const { agent_ids } = req.body;
    const company_id = getCompanyId(req.user);

    const list = await PowerDialerList.findOne({ _id: id, company_id });
    if (!list) return res.status(404).json({ status: "error", message: "List not found" });

    await PowerDialerList.findByIdAndUpdate(id, {
      assigned_to: (agent_ids || []).map((aid) => new mongoose.Types.ObjectId(aid)),
    });

    return res.status(200).json({ status: "success", message: "List assigned" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// GET /api/power-dialer/lists/:id/contacts
const getListContacts = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = getCompanyId(req.user);

    const list = await PowerDialerList.findOne({ _id: id, company_id });
    if (!list) return res.status(404).json({ status: "error", message: "List not found" });

    const contacts = await PowerDialerContact.find({ list_id: id })
      .sort({ order: 1 })
      .lean();

    return res.status(200).json({ status: "success", data: contacts });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// PUT /api/power-dialer/lists/:id — update list name
const updateList = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const company_id = getCompanyId(req.user);

    if (!name || !name.trim()) {
      return res.status(400).json({ status: "error", message: "List name required" });
    }

    const list = await PowerDialerList.findOneAndUpdate(
      { _id: id, company_id },
      { name: name.trim() },
      { new: true }
    );
    if (!list) return res.status(404).json({ status: "error", message: "List not found" });

    return res.status(200).json({ status: "success", data: list });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// PUT /api/power-dialer/lists/:id/reset — reset all contacts back to pending
const resetList = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = getCompanyId(req.user);

    const list = await PowerDialerList.findOne({ _id: id, company_id });
    if (!list) return res.status(404).json({ status: "error", message: "List not found" });

    await PowerDialerContact.updateMany(
      { list_id: id },
      { $set: { status: "pending", attempt_count: 0, last_called_at: null, disposition: "", notes: "" } }
    );

    return res.status(200).json({ status: "success", message: "List reset" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

module.exports = { createList, getLists, deleteList, updateList, assignList, resetList, getListContacts };
