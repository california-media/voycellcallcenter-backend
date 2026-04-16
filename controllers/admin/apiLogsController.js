const ApiLog = require("../../models/ApiLog");

// GET /superAdmin/api-logs
const getApiLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      method,
      statusCode,
      baseRoute,
      userId,
      search,       // search in url
      startDate,
      endDate,
    } = req.query;

    const filter = {};

    if (method) filter.method = method.toUpperCase();
    if (statusCode) filter.statusCode = parseInt(statusCode);
    if (baseRoute) filter.baseRoute = baseRoute;
    if (userId) filter.userId = userId;

    if (search) {
      filter.url = { $regex: search, $options: "i" };
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      ApiLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("userId", "firstname lastname email")
        .lean(),
      ApiLog.countDocuments(filter),
    ]);

    // Backfill userName/userEmail from populated userId for old logs that lack these fields
    logs.forEach((log) => {
      if (!log.userName && log.userId?.firstname) {
        log.userName = `${log.userId.firstname} ${log.userId.lastname || ""}`.trim();
      }
      if (!log.userEmail && log.userId?.email) {
        log.userEmail = log.userId.email;
      }
    });

    res.json({ success: true, logs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("getApiLogs error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch API logs" });
  }
};

// GET /superAdmin/api-logs/stats — aggregated metrics based on active filters (no pagination)
const getApiLogStats = async (req, res) => {
  try {
    const { method, statusCode, baseRoute, userId, search, startDate, endDate, groupBy = "hour" } = req.query;

    const filter = {};
    if (method)     filter.method = method.toUpperCase();
    if (statusCode) filter.statusCode = parseInt(statusCode);
    if (baseRoute)  filter.baseRoute = baseRoute;
    if (userId)     filter.userId = userId;
    if (search)     filter.url = { $regex: search, $options: "i" };
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const hasFilter = Object.keys(filter).length > 0;
    const matchStage = hasFilter ? [{ $match: filter }] : [];

    // Build time series grouping expression based on requested granularity
    const timeGroupExpr = {
      hour:  { $dateToString: { format: "%Y-%m-%d %H:00", date: "$createdAt" } },
      day:   { $dateToString: { format: "%Y-%m-%d",       date: "$createdAt" } },
      week:  { $dateToString: { format: "%G-W%V",         date: "$createdAt" } },
      month: { $dateToString: { format: "%Y-%m",          date: "$createdAt" } },
    }[groupBy] || { $dateToString: { format: "%Y-%m-%d %H:00", date: "$createdAt" } };

    const [
      methodBreakdown,
      statusBreakdown,
      timeSeriesBreakdown,
      topRoutes,
      summary,
    ] = await Promise.all([
      ApiLog.aggregate([...matchStage, { $group: { _id: "$method", count: { $sum: 1 } } }]),
      ApiLog.aggregate([
        ...matchStage,
        { $group: { _id: { $floor: { $divide: ["$statusCode", 100] } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      ApiLog.aggregate([
        ...matchStage,
        { $group: { _id: timeGroupExpr, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      ApiLog.aggregate([
        ...matchStage,
        { $group: { _id: "$baseRoute", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      ApiLog.aggregate([
        ...matchStage,
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            avgResponseTime: { $avg: "$responseTime" },
            errors5xx: { $sum: { $cond: [{ $gte: ["$statusCode", 500] }, 1, 0] } },
            success: { $sum: { $cond: [{ $and: [{ $gte: ["$statusCode", 200] }, { $lt: ["$statusCode", 400] }] }, 1, 0] } },
          },
        },
      ]),
    ]);

    res.json({
      success: true,
      methodBreakdown,
      statusBreakdown,
      timeSeriesBreakdown,
      topRoutes,
      summary: summary[0] || { total: 0, avgResponseTime: 0, errors5xx: 0, success: 0 },
    });
  } catch (err) {
    console.error("getApiLogStats error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch stats" });
  }
};

// GET /superAdmin/api-logs/timeseries — only the time series, used when groupBy changes
const getApiLogTimeSeries = async (req, res) => {
  try {
    const { method, statusCode, baseRoute, userId, search, startDate, endDate, groupBy = "hour" } = req.query;

    const filter = {};
    if (method)     filter.method = method.toUpperCase();
    if (statusCode) filter.statusCode = parseInt(statusCode);
    if (baseRoute)  filter.baseRoute = baseRoute;
    if (userId)     filter.userId = userId;
    if (search)     filter.url = { $regex: search, $options: "i" };
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const hasFilter = Object.keys(filter).length > 0;
    const matchStage = hasFilter ? [{ $match: filter }] : [];

    const timeGroupExpr = {
      hour:  { $dateToString: { format: "%Y-%m-%d %H:00", date: "$createdAt" } },
      day:   { $dateToString: { format: "%Y-%m-%d",       date: "$createdAt" } },
      week:  { $dateToString: { format: "%G-W%V",         date: "$createdAt" } },
      month: { $dateToString: { format: "%Y-%m",          date: "$createdAt" } },
    }[groupBy] || { $dateToString: { format: "%Y-%m-%d %H:00", date: "$createdAt" } };

    const timeSeries = await ApiLog.aggregate([
      ...matchStage,
      { $group: { _id: timeGroupExpr, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);

    res.json({ success: true, timeSeries });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch time series" });
  }
};

// GET /superAdmin/api-logs/routes — returns distinct base routes for filter dropdown
const getDistinctRoutes = async (req, res) => {
  try {
    const routes = await ApiLog.distinct("baseRoute");
    res.json({ success: true, routes: routes.sort() });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch routes" });
  }
};

// DELETE /superAdmin/api-logs/:logId
const deleteApiLog = async (req, res) => {
  try {
    await ApiLog.findByIdAndDelete(req.params.logId);
    res.json({ success: true, message: "Log deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete log" });
  }
};

// DELETE /superAdmin/api-logs/batch — delete selected logs by IDs
const deleteSelectedLogs = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "No IDs provided" });
    }
    await ApiLog.deleteMany({ _id: { $in: ids } });
    res.json({ success: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete selected logs" });
  }
};

// DELETE /superAdmin/api-logs — clear all logs
const clearAllLogs = async (req, res) => {
  try {
    await ApiLog.deleteMany({});
    res.json({ success: true, message: "All logs cleared" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to clear logs" });
  }
};

module.exports = { getApiLogs, getApiLogStats, getApiLogTimeSeries, getDistinctRoutes, deleteApiLog, deleteSelectedLogs, clearAllLogs };
