const User = require("../../models/userModel");
const Invoice = require("../../models/Invoice");
const mongoose = require("mongoose");

const getAllCompaniesBilling = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", statusFilter = "", dateFrom = null, dateTo = null } = req.body;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const searchFilter = { role: "companyAdmin" };
    if (search && search.trim() !== "") {
      const regex = new RegExp(search.trim(), "i");
      searchFilter.$or = [
        { firstname: regex },
        { lastname: regex },
        { email: regex },
        { "userInfo.companyName": regex },
      ];
    }
    if (statusFilter && statusFilter !== "all") {
      searchFilter.planStatus = statusFilter;
    }

    // Date filter: restrict to users who have invoices in the date range
    if (dateFrom || dateTo) {
      const invoiceMatch = {};
      if (dateFrom) invoiceMatch.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        invoiceMatch.$lte = end;
      }
      const matchingUserIds = await Invoice.distinct("userId", {
        stripeCreatedAt: invoiceMatch,
      });
      searchFilter._id = { $in: matchingUserIds };
    }

    const total = await User.countDocuments(searchFilter);
    const users = await User.find(searchFilter)
      .select("firstname lastname email userInfo.companyName planStatus stripeCustomerId trialEndsAt")
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const userIds = users.map((u) => u._id);

    // Build invoice stats — restrict to date range if provided
    const invoiceMatchStage = { userId: { $in: userIds } };
    if (dateFrom || dateTo) {
      invoiceMatchStage.stripeCreatedAt = {};
      if (dateFrom) invoiceMatchStage.stripeCreatedAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        invoiceMatchStage.stripeCreatedAt.$lte = end;
      }
    }

    const invoiceStats = await Invoice.aggregate([
      { $match: invoiceMatchStage },
      { $sort: { stripeCreatedAt: -1 } },
      {
        $group: {
          _id: "$userId",
          totalPaid: { $sum: "$amountPaid" },
          invoiceCount: { $sum: 1 },
          lastInvoiceDate: { $first: "$stripeCreatedAt" },
          lastInvoicePdf: { $first: "$invoicePdf" },
          lastInvoiceStatus: { $first: "$status" },
        },
      },
    ]);

    const statsMap = {};
    for (const stat of invoiceStats) {
      statsMap[stat._id.toString()] = stat;
    }

    const data = users.map((u) => {
      const stats = statsMap[u._id.toString()] || {};
      return {
        _id: u._id,
        name: `${u.firstname || ""} ${u.lastname || ""}`.trim(),
        email: u.email,
        companyName: u.userInfo?.companyName || "",
        planStatus: u.planStatus,
        stripeCustomerId: u.stripeCustomerId,
        trialEndsAt: u.trialEndsAt,
        totalPaid: stats.totalPaid || 0,
        invoiceCount: stats.invoiceCount || 0,
        lastInvoiceDate: stats.lastInvoiceDate || null,
        lastInvoicePdf: stats.lastInvoicePdf || null,
        lastInvoiceStatus: stats.lastInvoiceStatus || null,
      };
    });

    return res.json({ success: true, data, total });
  } catch (err) {
    console.error("getAllCompaniesBilling error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getCompanyInvoices = async (req, res) => {
  try {
    const { userId, page = 1, limit = 10 } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const user = await User.findById(userId)
      .select("firstname lastname email userInfo.companyName")
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const total = await Invoice.countDocuments({ userId });
    const invoices = await Invoice.find({ userId })
      .populate("planId", "name")
      .sort({ stripeCreatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    return res.json({
      success: true,
      invoices,
      total,
      companyName: user.userInfo?.companyName || "",
      email: user.email,
    });
  } catch (err) {
    console.error("getCompanyInvoices error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getAllCompaniesBilling, getCompanyInvoices };
