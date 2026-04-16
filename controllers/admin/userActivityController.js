const UserActivity = require("../../models/UserActivity");

// ── Called by frontend on every page navigation ───────────────────────────────
const savePageView = async (req, res) => {
  try {
    const { page, pageTitle, referrer, timeSpentSeconds, enteredAt, sessionId } = req.body;
    const user = req.user;
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;

    // Determine referrer type and host
    let referrerType = "direct";
    let referrerHost = null;

    if (referrer) {
      if (referrer.startsWith("/")) {
        referrerType = "internal";
      } else {
        try {
          const url = new URL(referrer);
          referrerHost = url.hostname.replace(/^www\./, "");
          referrerType = "external";
        } catch {
          referrerType = "internal";
        }
      }
    }

    await UserActivity.create({
      userId:    user?._id || null,
      userEmail: user?.email || null,
      userName:  user ? `${user.firstname || ""} ${user.lastname || ""}`.trim() || null : null,
      userRole:  user?.role || null,
      ip,
      sessionId: sessionId || null,
      page,
      pageTitle: pageTitle || null,
      referrer:  referrer || null,
      referrerType,
      referrerHost,
      enteredAt:        enteredAt ? new Date(enteredAt) : new Date(),
      timeSpentSeconds: typeof timeSpentSeconds === "number" ? timeSpentSeconds : 0,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("savePageView error:", err);
    res.status(500).json({ success: false });
  }
};

// ── Admin: paginated list ─────────────────────────────────────────────────────
const getUserActivity = async (req, res) => {
  try {
    const {
      page = 1, limit = 50,
      userId, userRole, referrerType,
      search,         // search in page / userEmail / userName
      startDate, endDate,
      sessionId,
    } = req.query;

    const filter = {};
    if (userId)       filter.userId = userId;
    if (userRole)     filter.userRole = userRole;
    if (referrerType) filter.referrerType = referrerType;
    if (sessionId)    filter.sessionId = sessionId;
    if (search) {
      filter.$or = [
        { page:       { $regex: search, $options: "i" } },
        { userEmail:  { $regex: search, $options: "i" } },
        { userName:   { $regex: search, $options: "i" } },
        { referrer:   { $regex: search, $options: "i" } },
      ];
    }
    if (startDate || endDate) {
      filter.enteredAt = {};
      if (startDate) filter.enteredAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.enteredAt.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [activities, total] = await Promise.all([
      UserActivity.find(filter).sort({ enteredAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      UserActivity.countDocuments(filter),
    ]);

    res.json({ success: true, activities, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("getUserActivity error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch activity" });
  }
};

// ── Admin: aggregated stats ───────────────────────────────────────────────────
const getUserActivityStats = async (req, res) => {
  try {
    const { userId, userRole, referrerType, search, startDate, endDate } = req.query;

    const filter = {};
    if (userId)       filter.userId = userId;
    if (userRole)     filter.userRole = userRole;
    if (referrerType) filter.referrerType = referrerType;
    if (search) {
      filter.$or = [
        { page:      { $regex: search, $options: "i" } },
        { userEmail: { $regex: search, $options: "i" } },
        { userName:  { $regex: search, $options: "i" } },
      ];
    }
    if (startDate || endDate) {
      filter.enteredAt = {};
      if (startDate) filter.enteredAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.enteredAt.$lte = end;
      }
    }

    const match = Object.keys(filter).length ? [{ $match: filter }] : [];

    const [
      topPages,
      avgTimePerPage,
      referrerBreakdown,
      topReferrerHosts,
      topUsers,
      summary,
    ] = await Promise.all([
      // Most visited pages
      UserActivity.aggregate([
        ...match,
        { $group: { _id: "$page", count: { $sum: 1 }, avgTime: { $avg: "$timeSpentSeconds" } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      // Avg time spent per page (top 10 by time)
      UserActivity.aggregate([
        ...match,
        { $group: { _id: "$page", avgTime: { $avg: "$timeSpentSeconds" }, count: { $sum: 1 } } },
        { $match: { count: { $gte: 2 } } },
        { $sort: { avgTime: -1 } },
        { $limit: 10 },
      ]),
      // Referrer type breakdown (direct / internal / external)
      UserActivity.aggregate([
        ...match,
        { $group: { _id: "$referrerType", count: { $sum: 1 } } },
      ]),
      // Top external referrer domains
      UserActivity.aggregate([
        ...match,
        { $match: { referrerType: "external", referrerHost: { $ne: null } } },
        { $group: { _id: "$referrerHost", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      // Most active users
      UserActivity.aggregate([
        ...match,
        { $group: { _id: "$userEmail", name: { $first: "$userName" }, pageViews: { $sum: 1 }, totalTime: { $sum: "$timeSpentSeconds" } } },
        { $sort: { pageViews: -1 } },
        { $limit: 10 },
      ]),
      // Summary
      UserActivity.aggregate([
        ...match,
        {
          $group: {
            _id: null,
            totalPageViews: { $sum: 1 },
            totalSessions: { $addToSet: "$sessionId" },
            avgTimeSpent:   { $avg: "$timeSpentSeconds" },
          },
        },
      ]),
    ]);

    res.json({
      success: true,
      topPages,
      avgTimePerPage,
      referrerBreakdown,
      topReferrerHosts,
      topUsers,
      summary: summary[0]
        ? {
            totalPageViews: summary[0].totalPageViews,
            uniqueSessions: summary[0].totalSessions.filter(Boolean).length,
            avgTimeSpent:   Math.round(summary[0].avgTimeSpent || 0),
          }
        : { totalPageViews: 0, uniqueSessions: 0, avgTimeSpent: 0 },
    });
  } catch (err) {
    console.error("getUserActivityStats error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};

// ── Admin: navigation path for a single session ───────────────────────────────
const getSessionPath = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const path = await UserActivity.find({ sessionId })
      .sort({ enteredAt: 1 })
      .select("page pageTitle enteredAt timeSpentSeconds referrer referrerType")
      .lean();
    res.json({ success: true, path });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch session path" });
  }
};

module.exports = { savePageView, getUserActivity, getUserActivityStats, getSessionPath };
