const UAParser = require("ua-parser-js");
const UserSession = require("../../models/UserSession");
const User = require("../../models/userModel");

// ── Called by frontend on login ───────────────────────────────────────────────
const saveUserSession = async (req, res) => {
  try {
    const { screenWidth, screenHeight, viewportWidth, viewportHeight, pixelRatio, timezone, language } = req.body;

    const ua = req.headers["user-agent"] || "";
    const parser = new UAParser(ua);
    const browserResult = parser.getBrowser();
    const osResult     = parser.getOS();
    const deviceResult = parser.getDevice();

    const deviceType = deviceResult.type
      ? (deviceResult.type === "mobile" ? "mobile" : deviceResult.type === "tablet" ? "tablet" : "desktop")
      : "desktop";

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;

    const user = req.user;

    await UserSession.create({
      userId:    user._id,
      userEmail: user.email || null,
      userName:  `${user.firstname || ""} ${user.lastname || ""}`.trim() || null,
      userRole:  user.role || null,
      ip,
      userAgent:      ua,
      browser:        `${browserResult.name || ""} ${browserResult.version || ""}`.trim() || null,
      browserName:    browserResult.name || null,
      browserVersion: browserResult.version || null,
      os:             `${osResult.name || ""} ${osResult.version || ""}`.trim() || null,
      osName:         osResult.name || null,
      osVersion:      osResult.version || null,
      deviceType,
      deviceVendor: deviceResult.vendor || null,
      deviceModel:  deviceResult.model  || null,
      screenWidth:    screenWidth  || null,
      screenHeight:   screenHeight || null,
      viewportWidth:  viewportWidth  || null,
      viewportHeight: viewportHeight || null,
      pixelRatio:     pixelRatio || null,
      timezone: timezone || null,
      language: language || null,
      loginAt:  new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error("saveUserSession error:", err);
    res.status(500).json({ success: false, message: "Failed to save session" });
  }
};

// ── Admin: get all sessions ───────────────────────────────────────────────────
const getUserSessions = async (req, res) => {
  try {
    const {
      page = 1, limit = 50,
      userId, userRole, deviceType,
      search,       // search in email/name
      startDate, endDate,
    } = req.query;

    const filter = {};
    if (userId)     filter.userId = userId;
    if (userRole)   filter.userRole = userRole;
    if (deviceType) filter.deviceType = deviceType;
    if (search)     filter.$or = [
      { userEmail: { $regex: search, $options: "i" } },
      { userName:  { $regex: search, $options: "i" } },
      { ip:        { $regex: search, $options: "i" } },
    ];
    if (startDate || endDate) {
      filter.loginAt = {};
      if (startDate) filter.loginAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.loginAt.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [sessions, total] = await Promise.all([
      UserSession.find(filter).sort({ loginAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      UserSession.countDocuments(filter),
    ]);

    res.json({ success: true, sessions, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("getUserSessions error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch sessions" });
  }
};

// ── Admin: session metrics summary ───────────────────────────────────────────
const getSessionStats = async (req, res) => {
  try {
    const { userRole, deviceType, search, startDate, endDate } = req.query;

    const match = {};
    if (userRole)   match.userRole = userRole;
    if (deviceType) match.deviceType = deviceType;
    if (search)     match.$or = [
      { userEmail: { $regex: search, $options: "i" } },
      { userName:  { $regex: search, $options: "i" } },
      { ip:        { $regex: search, $options: "i" } },
    ];
    if (startDate || endDate) {
      match.loginAt = {};
      if (startDate) match.loginAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        match.loginAt.$lte = end;
      }
    }

    const hasMatch = Object.keys(match).length > 0;
    const pipeline = (groupStage, extra = []) => [
      ...(hasMatch ? [{ $match: match }] : []),
      groupStage,
      ...extra,
    ];

    const [deviceBreakdown, browserBreakdown, osBreakdown, topUsers] = await Promise.all([
      UserSession.aggregate(pipeline({ $group: { _id: "$deviceType", count: { $sum: 1 } } })),
      UserSession.aggregate(pipeline({ $group: { _id: "$browserName", count: { $sum: 1 } } }, [{ $sort: { count: -1 } }, { $limit: 8 }])),
      UserSession.aggregate(pipeline({ $group: { _id: "$osName",      count: { $sum: 1 } } }, [{ $sort: { count: -1 } }, { $limit: 8 }])),
      UserSession.aggregate(pipeline(
        { $group: { _id: "$userEmail", name: { $first: "$userName" }, count: { $sum: 1 } } },
        [{ $sort: { count: -1 } }, { $limit: 10 }]
      )),
    ]);

    res.json({ success: true, deviceBreakdown, browserBreakdown, osBreakdown, topUsers });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};

module.exports = { saveUserSession, getUserSessions, getSessionStats };
