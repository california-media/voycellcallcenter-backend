const DIDLogicSettings = require("../../models/DIDLogicSettings");
const DIDAssignment = require("../../models/DIDAssignment");
const User = require("../../models/userModel");
const did = require("../../services/didlogicService");
const { deriveNumberType } = require("../../utils/didCountryData");

function applyMargin(basePrice, marginPercent) {
  return parseFloat((basePrice * (1 + marginPercent / 100)).toFixed(4));
}

// ── Settings ──────────────────────────────────────────────────────────────────

const getSettings = async (req, res) => {
  try {
    let settings = await DIDLogicSettings.findOne({ key: "global" }).lean();
    if (!settings) settings = await DIDLogicSettings.create({ key: "global" });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateSettings = async (req, res) => {
  try {
    const { apiToken, isTestMode, numberMarginPercent, activationMarginPercent, callMarginPercent } = req.body;
    const update = {};
    if (apiToken !== undefined) update.apiToken = apiToken;
    if (isTestMode !== undefined) update.isTestMode = !!isTestMode;
    if (numberMarginPercent !== undefined)     update.numberMarginPercent     = Number(numberMarginPercent);
    if (activationMarginPercent !== undefined) update.activationMarginPercent = Number(activationMarginPercent);
    if (callMarginPercent !== undefined)       update.callMarginPercent       = Number(callMarginPercent);

    const settings = await DIDLogicSettings.findOneAndUpdate(
      { key: "global" },
      { $set: update },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: settings, message: "DIDLogic settings saved." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Master Numbers (sync + manage assignments) ────────────────────────────────

const syncNumbers = async (req, res) => {
  try {
    const data = await did.getMasterPurchases({ perPage: 200 });
    const purchases = data.purchases || [];
    const settings = await DIDLogicSettings.findOne({ key: "global" }).lean();
    const margin = settings?.numberMarginPercent ?? 0;

    for (const p of purchases) {
      const ourPrice = applyMargin(p.monthly_fee || 0, margin);
      const numberType = deriveNumberType(p.area);
      await DIDAssignment.findOneAndUpdate(
        { number: p.number },
        {
          $setOnInsert: {
            number: p.number,
            countryName: p.country || "",
            area: p.area || "",
            numberType,
            didlogicMonthlyFee: p.monthly_fee || 0,
            ourMonthlyPrice: ourPrice,
            marginPercent: margin,
            status: "available",
            companyAdminId: null,
            assignedAt: null,
          },
        },
        { upsert: true, new: false }
      );
      // Refresh pricing on existing available numbers when margin changes
      await DIDAssignment.updateMany(
        { number: p.number, status: "available" },
        { $set: { ourMonthlyPrice: ourPrice, marginPercent: margin, numberType, didlogicMonthlyFee: p.monthly_fee || 0 } }
      );
    }

    res.json({ success: true, message: `Synced ${purchases.length} numbers from DIDLogic.`, count: purchases.length });
  } catch (err) {
    console.error("syncNumbers error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllNumbers = async (req, res) => {
  try {
    const { page = 1, limit = 50, status, companyAdminId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const filter = {};
    if (status) filter.status = status;
    if (companyAdminId) filter.companyAdminId = companyAdminId;

    const [numbers, total] = await Promise.all([
      DIDAssignment.find(filter)
        .populate("companyAdminId", "firstname lastname email")
        .populate("assignedAgentId", "firstname lastname email")
        .sort({ countryName: 1, number: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      DIDAssignment.countDocuments(filter),
    ]);

    res.json({ success: true, data: numbers, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updateNumberMargin = async (req, res) => {
  try {
    const { id } = req.params;
    const { ourMonthlyPrice, marginPercent } = req.body;
    await DIDAssignment.findByIdAndUpdate(id, { $set: { ourMonthlyPrice, marginPercent } });
    res.json({ success: true, message: "Number pricing updated." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getCallRecords = async (req, res) => {
  try {
    const { from, to, page = 1, perPage = 100 } = req.query;
    const result = await did.getCallRecords({ from, to, page, perPage });
    res.json({ success: true, data: result.calls || [], pagination: result.pagination || {} });
  } catch (err) {
    console.error("admin getCallRecords error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /superAdmin/didlogic/balance ──────────────────────────────────────────
// Returns the live DIDLogic account balance
const getAccountBalance = async (req, res) => {
  try {
    const balance = await did.getBalance();
    // DIDLogic v1 returns the balance as a plain number or { balance: number }
    const amount = typeof balance === "object" ? (balance.balance ?? balance.amount ?? 0) : parseFloat(balance) || 0;
    res.json({ success: true, data: { balance: amount } });
  } catch (err) {
    console.error("getAccountBalance error:", err.message);
    res.status(err.response?.status || 500).json({ success: false, message: err.response?.data?.message || err.message });
  }
};

// ── PUT /superAdmin/didlogic/numbers/:id/assign-company ───────────────────────
// Super admin assigns (or unassigns) a DID directly to a company admin for free.
// Body: { companyAdminId } — omit or pass null to return number to inventory.
const assignNumberToCompany = async (req, res) => {
  try {
    const { id } = req.params;
    const { companyAdminId } = req.body;

    const record = await DIDAssignment.findById(id);
    if (!record) return res.status(404).json({ success: false, message: "Number not found." });

    if (!companyAdminId) {
      await DIDAssignment.findByIdAndUpdate(id, {
        status: "available",
        companyAdminId: null,
        assignedAt: null,
        assignedAgentId: null,
        assignedAgentAt: null,
      });
      return res.json({ success: true, message: `Number +${record.number} returned to inventory.` });
    }

    const admin = await User.findOne({ _id: companyAdminId, role: "companyAdmin" })
      .select("firstname lastname email");
    if (!admin) return res.status(404).json({ success: false, message: "Company admin not found." });

    await DIDAssignment.findByIdAndUpdate(id, {
      status: "assigned",
      companyAdminId,
      assignedAt: new Date(),
      assignedAgentId: null,
      assignedAgentAt: null,
    });

    res.json({
      success: true,
      message: `Number +${record.number} assigned to ${admin.firstname} ${admin.lastname}.`,
    });
  } catch (err) {
    console.error("assignNumberToCompany error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /superAdmin/didlogic/company-admins ───────────────────────────────────
// Returns all company admins for the assignment dropdown.
const getCompanyAdmins = async (req, res) => {
  try {
    const admins = await User.find({ role: "companyAdmin" })
      .select("firstname lastname email")
      .sort({ firstname: 1 })
      .lean();
    res.json({ success: true, data: admins });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getSettings, updateSettings, syncNumbers, getAllNumbers, updateNumberMargin, getCallRecords, getAccountBalance, assignNumberToCompany, getCompanyAdmins };
