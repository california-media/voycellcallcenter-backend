const WabaFlow = require("../models/WabaFlow");
const WabaFlowSession = require("../models/WabaFlowSession");
const WabaFlowSubmission = require("../models/WabaFlowSubmission");
const User = require("../models/userModel");

const getCompanyAdminId = async (userId) => {
  const user = await User.findById(userId).select("role createdByWhichCompanyAdmin");
  if (user.role === "companyAdmin" || user.role === "superadmin") return user._id;
  return user.createdByWhichCompanyAdmin;
};

// GET /api/waba/flows
exports.list = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const flows = await WabaFlow.find({ companyAdmin }).select("-nodes -edges").sort({ createdAt: -1 });
    res.json({ success: true, data: flows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/waba/flows/:id
exports.get = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const flow = await WabaFlow.findOne({ _id: req.params.id, companyAdmin });
    if (!flow) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: flow });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/waba/flows
exports.create = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const { name, description, nodes, edges } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "name required" });
    const flow = await WabaFlow.create({ companyAdmin, name, description, nodes: nodes || [], edges: edges || [] });
    res.status(201).json({ success: true, data: flow });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/waba/flows/:id
exports.update = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const flow = await WabaFlow.findOneAndUpdate(
      { _id: req.params.id, companyAdmin },
      req.body,
      { new: true }
    );
    if (!flow) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: flow });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/waba/flows/:id
exports.remove = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const flow = await WabaFlow.findOneAndDelete({ _id: req.params.id, companyAdmin });
    if (!flow) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/waba/flows/:id/toggle
exports.toggle = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const flow = await WabaFlow.findOne({ _id: req.params.id, companyAdmin });
    if (!flow) return res.status(404).json({ success: false, message: "Not found" });
    flow.isActive = !flow.isActive;
    await flow.save();
    res.json({ success: true, data: flow });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/waba/flows/:id/submissions
exports.submissions = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const [submissions, total] = await Promise.all([
      WabaFlowSubmission.find({ flow: req.params.id, companyAdmin })
        .sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      WabaFlowSubmission.countDocuments({ flow: req.params.id, companyAdmin }),
    ]);
    res.json({ success: true, data: submissions, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/waba/flows/:id/trigger — manually start a flow for a phone number
exports.manualTrigger = async (req, res) => {
  try {
    const companyAdmin = await getCompanyAdminId(req.user._id);
    const flow = await WabaFlow.findOne({ _id: req.params.id, companyAdmin, isActive: true });
    if (!flow) return res.status(404).json({ success: false, message: "Flow not found or inactive" });

    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "phone required" });

    // Kill any existing active session for this phone on any flow under this company
    await WabaFlowSession.updateMany(
      { companyAdmin, contactPhone: phone, status: "active" },
      { status: "timeout" }
    );

    // Find trigger node
    const triggerNode = flow.nodes.find((n) => n.type === "trigger");
    if (!triggerNode) return res.status(400).json({ success: false, message: "Flow has no trigger node" });

    // Find first node after trigger
    const firstEdge = flow.edges.find((e) => e.source === triggerNode.id);
    const firstNodeId = firstEdge?.target;

    const session = await WabaFlowSession.create({
      flow: flow._id,
      companyAdmin,
      contactPhone: phone,
      currentNodeId: firstNodeId || triggerNode.id,
      status: "active",
    });

    // Execute first node
    const { executeNode } = require("../services/wabaFlowEngine");
    await executeNode(session, flow, null);

    res.json({ success: true, message: "Flow started", session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
