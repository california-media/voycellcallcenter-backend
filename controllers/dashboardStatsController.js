const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const User = require("../models/userModel");
const WhatsAppMessage = require("../models/whatsappMessage");

/**
 * GET /dashboard/quick-stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Returns stats filtered to the requested date range.
 * Role-aware: companyAdmin sees all agents' data; agent sees own data only.
 */
const getDashboardQuickStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).lean();
    if (!user) return res.status(401).json({ status: "error", message: "Unauthorized" });

    // ── Date range ──────────────────────────────────────────────
    const todayStr = new Date().toISOString().slice(0, 10);
    const startStr = req.query.startDate || todayStr;
    const endStr   = req.query.endDate   || todayStr;

    // Inclusive date boundaries as Date objects
    const startDate = new Date(`${startStr}T00:00:00.000Z`);
    const endDate   = new Date(`${endStr}T23:59:59.999Z`);

    // ── Build user scope ─────────────────────────────────────────
    let userIdsToFetch = [userId];
    if (user.role === "companyAdmin") {
      const agents = await User.find({ createdByWhichCompanyAdmin: userId }).select("_id").lean();
      userIdsToFetch = [userId, ...agents.map((a) => a._id)];
    }

    const ownerFilter = {
      $or: [
        { createdBy: { $in: userIdsToFetch } },
        { assignedTo: { $in: userIdsToFetch } },
      ],
    };

    // ── 1. Total leads created in range ─────────────────────────
    const totalLeads = await Lead.countDocuments({
      ...ownerFilter,
      createdAt: { $gte: startDate, $lte: endDate },
    });

    // ── 2. Distinct WABA conversations active in range ───────────
    const wabaAgg = await WhatsAppMessage.aggregate([
      {
        $match: {
          userId: { $in: userIdsToFetch },
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      { $group: { _id: "$conversationId" } },
      { $count: "total" },
    ]);
    const totalWabaChats = wabaAgg[0]?.total || 0;

    // ── 3. Meetings in range ─────────────────────────────────────
    const [contacts, leads] = await Promise.all([
      Contact.find({ ...ownerFilter, "meetings.0": { $exists: true } })
        .select("meetings firstname lastname")
        .lean(),
      Lead.find({ ...ownerFilter, "meetings.0": { $exists: true } })
        .select("meetings firstname lastname")
        .lean(),
    ]);

    // meetingStartDate is stored as "YYYY-MM-DD" string — compare lexicographically
    const inRange = (val) => {
      if (!val) return false;
      try {
        const d = typeof val === "string" ? val.slice(0, 10) : new Date(val).toISOString().slice(0, 10);
        return d >= startStr && d <= endStr;
      } catch {
        return false;
      }
    };

    let totalMeetings = 0;
    const periodMeetings = [];

    const extractMeetings = (docs) => {
      docs.forEach((doc) => {
        const name = `${doc.firstname || ""} ${doc.lastname || ""}`.trim();
        (doc.meetings || []).forEach((m) => {
          if (!m.meetingStartDate) return;
          if (inRange(m.meetingStartDate)) {
            totalMeetings++;
            periodMeetings.push({
              meeting_id: m._id,
              meetingTitle: m.meetingTitle || "Meeting",
              meetingStartDate: m.meetingStartDate,
              meetingStartTime: m.meetingStartTime || "",
              meetingType: m.meetingType || "",
              contactName: name,
            });
          }
        });
      });
    };

    extractMeetings(contacts);
    extractMeetings(leads);

    // Sort by date then time ascending
    periodMeetings.sort((a, b) => {
      const da = `${a.meetingStartDate} ${a.meetingStartTime || "00:00"}`;
      const db = `${b.meetingStartDate} ${b.meetingStartTime || "00:00"}`;
      return da.localeCompare(db);
    });

    res.json({
      status: "success",
      data: {
        totalLeads,
        totalWabaChats,
        totalMeetings,
        todayMeetings: periodMeetings,
        todayMeetingsCount: periodMeetings.length,
        startDate: startStr,
        endDate: endStr,
      },
    });
  } catch (err) {
    console.error("Dashboard quick stats error:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
};

module.exports = { getDashboardQuickStats };
