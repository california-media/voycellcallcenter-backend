// voycellcallcenter-backend/controllers/powerDialerSessionController.js
const PowerDialerSession = require("../models/PowerDialerSession");
const PowerDialerCampaign = require("../models/PowerDialerCampaign");
const PowerDialerContact = require("../models/PowerDialerContact");

const getCompanyId = (user) => {
  if (user.role === "companyAdmin") return user._id;
  if (user.role === "user") return user.createdByWhichCompanyAdmin;
  return null;
};

// POST /api/power-dialer/sessions
// Body: { campaign_id }
// Returns: { session, contact } — contact has .phone to auto-dial
const startSession = async (req, res) => {
  try {
    const { campaign_id } = req.body;
    const company_id = getCompanyId(req.user);
    const agent_id = req.user._id;

    const existing = await PowerDialerSession.findOne({
      agent_id,
      status: { $in: ["active", "paused"] },
    });
    if (existing) {
      return res.status(400).json({ status: "error", message: "You already have an active session. Stop it first." });
    }

    const campaign = await PowerDialerCampaign.findOne({ _id: campaign_id, company_id });
    if (!campaign) return res.status(404).json({ status: "error", message: "Campaign not found" });

    const total = await PowerDialerContact.countDocuments({ list_id: campaign.list_id });
    if (total === 0) {
      return res.status(400).json({ status: "error", message: "This list has no contacts" });
    }

    // Always skip contacts whose disposition matches the campaign's configured dispositions
    const skipDispositions = (campaign.call_dispositions || []).filter(Boolean);

    const firstContactQuery = { list_id: campaign.list_id };
    if (skipDispositions.length > 0) {
      firstContactQuery.$or = [
        { disposition: { $nin: skipDispositions } },
        { disposition: { $in: [null, ""] } },
        { disposition: { $exists: false } },
      ];
    }

    const firstContact = await PowerDialerContact.findOne(firstContactQuery).sort({ order: 1 });
    if (!firstContact) {
      return res.status(400).json({ status: "error", message: "All contacts have been completed with a final disposition. No contacts to re-dial." });
    }

    const session = await PowerDialerSession.create({
      campaign_id,
      agent_id,
      company_id,
      current_contact_id: firstContact._id,
      skip_dispositions: skipDispositions,
    });

    if (campaign.status !== "active") {
      campaign.status = "active";
      await campaign.save();
    }

    return res.status(201).json({ status: "success", data: { session, contact: firstContact, from_number: campaign.from_number || null } });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// GET /api/power-dialer/sessions/active
const getActiveSession = async (req, res) => {
  try {
    const session = await PowerDialerSession.findOne({
      agent_id: req.user._id,
      status: { $in: ["active", "paused"] },
    }).populate("campaign_id");

    if (!session) return res.status(200).json({ status: "success", data: null });

    const contact = session.current_contact_id
      ? await PowerDialerContact.findById(session.current_contact_id)
      : null;

    return res.status(200).json({ status: "success", data: { session, contact } });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// PUT /api/power-dialer/sessions/:id/pause
const pauseSession = async (req, res) => {
  try {
    const session = await PowerDialerSession.findOne({ _id: req.params.id, agent_id: req.user._id });
    if (!session) return res.status(404).json({ status: "error", message: "Session not found" });

    session.status = "paused";
    session.last_updated = new Date();
    await session.save();

    return res.status(200).json({ status: "success", data: session });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// PUT /api/power-dialer/sessions/:id/resume
// Returns current contact so frontend can re-dial if needed
const resumeSession = async (req, res) => {
  try {
    const session = await PowerDialerSession.findOne({ _id: req.params.id, agent_id: req.user._id });
    if (!session) return res.status(404).json({ status: "error", message: "Session not found" });

    session.status = "active";
    session.last_updated = new Date();
    await session.save();

    const contact = session.current_contact_id
      ? await PowerDialerContact.findById(session.current_contact_id)
      : null;

    return res.status(200).json({ status: "success", data: { session, contact } });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// PUT /api/power-dialer/sessions/:id/stop
const stopSession = async (req, res) => {
  try {
    const session = await PowerDialerSession.findOne({ _id: req.params.id, agent_id: req.user._id });
    if (!session) return res.status(404).json({ status: "error", message: "Session not found" });

    session.status = "stopped";
    session.last_updated = new Date();
    await session.save();

    return res.status(200).json({ status: "success", data: session });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// POST /api/power-dialer/sessions/:id/next
// Body: { disposition, notes, contact_status }
// Saves result for current contact, returns next contact (or done:true)
const nextContact = async (req, res) => {
  try {
    const { disposition, notes, contact_status } = req.body;

    const session = await PowerDialerSession.findOne({
      _id: req.params.id,
      agent_id: req.user._id,
      status: "active",
    }).populate("campaign_id");

    if (!session) return res.status(404).json({ status: "error", message: "Active session not found" });

    if (session.current_contact_id) {
      const currentContact = await PowerDialerContact.findById(session.current_contact_id);

      await PowerDialerContact.findByIdAndUpdate(session.current_contact_id, {
        status: contact_status || "called",
        disposition: disposition || "",
        notes: notes || "",
        last_called_at: new Date(),
        $inc: { attempt_count: 1 },
      });

      await PowerDialerCampaign.findByIdAndUpdate(session.campaign_id._id, {
        $inc: { calls_completed: 1 },
        updated_at: new Date(),
      });

      // Find next contact after current order, skipping final-disposition contacts if this is a restart
      const nextQuery = {
        list_id: session.campaign_id.list_id,
        order: { $gt: currentContact.order },
      };
      const sessionSkip = session.skip_dispositions || [];
      if (sessionSkip.length > 0) {
        nextQuery.$or = [
          { disposition: { $nin: sessionSkip } },
          { disposition: { $in: [null, ""] } },
          { disposition: { $exists: false } },
        ];
      }
      const nextCon = await PowerDialerContact.findOne(nextQuery).sort({ order: 1 });

      session.contacts_called += 1;

      if (!nextCon) {
        session.status = "completed";
        session.current_contact_id = null;
        await session.save();

        await PowerDialerCampaign.findByIdAndUpdate(session.campaign_id._id, {
          status: "completed",
        });

        return res.status(200).json({
          status: "success",
          data: { session, contact: null, done: true },
        });
      }

      session.current_contact_id = nextCon._id;
      session.last_updated = new Date();
      await session.save();

      return res.status(200).json({
        status: "success",
        data: { session, contact: nextCon, done: false },
      });
    }

    return res.status(400).json({ status: "error", message: "No current contact in session" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

// GET /api/power-dialer/live
// Polling endpoint — admin sees all active sessions across company
const getLiveStats = async (req, res) => {
  try {
    const company_id = getCompanyId(req.user);

    const activeSessions = await PowerDialerSession.find({
      company_id,
      status: "active",
    })
      .populate("agent_id", "firstname lastname")
      .populate("campaign_id", "name from_number calls_completed list_id")
      .populate("current_contact_id", "name phone");

    const campaignIds = [...new Set(
      activeSessions.map((s) => s.campaign_id?._id?.toString()).filter(Boolean)
    )];
    const campaigns = await PowerDialerCampaign.find({ _id: { $in: campaignIds } });
    const listIds = [...new Set(campaigns.map((c) => c.list_id?.toString()).filter(Boolean))];

    const [totalContacts, pendingContacts] = await Promise.all([
      require("../models/PowerDialerContact").countDocuments({ list_id: { $in: listIds } }),
      require("../models/PowerDialerContact").countDocuments({ list_id: { $in: listIds }, status: "pending" }),
    ]);

    const completedCalls = campaigns.reduce((sum, c) => sum + (c.calls_completed || 0), 0);

    const rows = activeSessions.map((s) => ({
      session_id: s._id,
      campaign_name: s.campaign_id?.name || "",
      agent_name: s.agent_id ? `${s.agent_id.firstname} ${s.agent_id.lastname}` : "",
      from_number: s.campaign_id?.from_number || "",
      to_number: s.current_contact_id?.phone || "",
      contact_name: s.current_contact_id?.name || "",
      start_time: s.last_updated,
      status: s.status,
    }));

    return res.status(200).json({
      status: "success",
      data: {
        stats: {
          total_calls: totalContacts,
          completed_calls: completedCalls,
          pending_calls: pendingContacts,
          failed_calls: 0,
          active_users: activeSessions.length,
        },
        rows,
      },
    });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err.message });
  }
};

module.exports = {
  startSession, getActiveSession,
  pauseSession, resumeSession, stopSession,
  nextContact, getLiveStats,
};
