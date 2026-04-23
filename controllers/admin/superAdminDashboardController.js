const User = require("../../models/userModel");
const Subscription = require("../../models/Subscription");
const Invoice = require("../../models/Invoice");

/**
 * GET /admin/dashboard-stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Superadmin-only. Returns platform-wide stats filtered to the date range.
 */
const getSuperAdminDashboardStats = async (req, res) => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const startStr = req.query.startDate || todayStr;
    const endStr   = req.query.endDate   || todayStr;

    const startDate = new Date(`${startStr}T00:00:00.000Z`);
    const endDate   = new Date(`${endStr}T23:59:59.999Z`);

    // ── 1. Companies onboarded (companyAdmin accounts) ──────────────
    const [totalCompanies, newCompanies] = await Promise.all([
      User.countDocuments({ role: "companyAdmin" }),
      User.countDocuments({ role: "companyAdmin", createdAt: { $gte: startDate, $lte: endDate } }),
    ]);

    // ── 2. Plan status breakdown (all-time) ─────────────────────────
    const [activeSubscriptions, trialAccounts, cancelledAccounts, expiredAccounts] = await Promise.all([
      User.countDocuments({ role: "companyAdmin", planStatus: "active" }),
      User.countDocuments({ role: "companyAdmin", planStatus: "trial" }),
      User.countDocuments({ role: "companyAdmin", planStatus: "cancelled" }),
      User.countDocuments({ role: "companyAdmin", planStatus: "expired" }),
    ]);

    // ── 3. Revenue from invoices ─────────────────────────────────────
    const [totalRevenueAgg, periodRevenueAgg, pendingAgg, failedAgg] = await Promise.all([
      // All-time paid revenue
      Invoice.aggregate([
        { $match: { status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amountPaid" } } },
      ]),
      // Period paid revenue
      Invoice.aggregate([
        { $match: { status: "paid", createdAt: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: null, total: { $sum: "$amountPaid" }, count: { $sum: 1 } } },
      ]),
      // Open/pending invoices
      Invoice.aggregate([
        { $match: { status: "open" } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
      // Failed/uncollectible invoices (all-time)
      Invoice.aggregate([
        { $match: { status: "uncollectible" } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
      ]),
    ]);

    const totalRevenue     = (totalRevenueAgg[0]?.total   || 0) / 100;
    const periodRevenue    = (periodRevenueAgg[0]?.total  || 0) / 100;
    const periodInvoices   = periodRevenueAgg[0]?.count   || 0;
    const pendingAmount    = (pendingAgg[0]?.total        || 0) / 100;
    const pendingCount     = pendingAgg[0]?.count         || 0;
    const failedAmount     = (failedAgg[0]?.total         || 0) / 100;
    const failedCount      = failedAgg[0]?.count          || 0;

    // ── 4. Revenue by day in period (for chart) ──────────────────────
    const revenueByDay = await Invoice.aggregate([
      { $match: { status: "paid", createdAt: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: "$amountPaid" },
          count:   { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ── 5. New companies by day in period (for chart) ────────────────
    const companiesByDay = await User.aggregate([
      { $match: { role: "companyAdmin", createdAt: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ── 6. Recent paid invoices ──────────────────────────────────────
    const recentInvoices = await Invoice.find({ status: "paid" })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("userId", "email userInfo.companyName firstname lastname")
      .lean();

    res.json({
      status: "success",
      data: {
        companies: { total: totalCompanies, new: newCompanies },
        subscriptions: { active: activeSubscriptions, trial: trialAccounts, cancelled: cancelledAccounts, expired: expiredAccounts },
        revenue: { total: totalRevenue, period: periodRevenue, periodInvoices },
        pending: { amount: pendingAmount, count: pendingCount },
        failed: { amount: failedAmount, count: failedCount },
        charts: { revenueByDay, companiesByDay },
        recentInvoices,
        dateRange: { startDate: startStr, endDate: endStr },
      },
    });
  } catch (err) {
    console.error("SuperAdmin dashboard stats error:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
};

module.exports = { getSuperAdminDashboardStats };
