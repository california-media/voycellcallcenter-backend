const WabaBasicReply = require("../models/WabaBasicReply");
const User = require("../models/userModel");

const getCompanyAdminId = async (userId) => {
  const user = await User.findById(userId).select("role createdByWhichCompanyAdmin");
  if (user.role === "companyAdmin" || user.role === "superadmin") return user._id;
  return user.createdByWhichCompanyAdmin;
};

// GET /api/waba/basic-replies
exports.list = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const replies = await WabaBasicReply.find({ companyAdmin }).sort({ createdAt: -1 });
    res.json({ success: true, data: replies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/waba/basic-replies
exports.create = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const { name, trigger, matchCriteria, responses, businessHours } = req.body;
    if (!name || !trigger) return res.status(400).json({ success: false, message: "name and trigger required" });

    const reply = await WabaBasicReply.create({ companyAdmin, name, trigger, matchCriteria, responses, businessHours });
    res.status(201).json({ success: true, data: reply });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/waba/basic-replies/:id
exports.update = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const reply = await WabaBasicReply.findOneAndUpdate(
      { _id: req.params.id, companyAdmin },
      req.body,
      { new: true }
    );
    if (!reply) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: reply });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/waba/basic-replies/:id
exports.remove = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const reply = await WabaBasicReply.findOneAndDelete({ _id: req.params.id, companyAdmin });
    if (!reply) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/waba/basic-replies/:id/toggle
exports.toggle = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const reply = await WabaBasicReply.findOne({ _id: req.params.id, companyAdmin });
    if (!reply) return res.status(404).json({ success: false, message: "Not found" });
    reply.isActive = !reply.isActive;
    await reply.save();
    res.json({ success: true, data: reply });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
