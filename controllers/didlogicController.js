const did = require("../services/didlogicService");
const DIDLogicSettings = require("../models/DIDLogicSettings");
const DIDAssignment = require("../models/DIDAssignment");
const DIDTransaction = require("../models/DIDTransaction");
const User = require("../models/userModel");
const { getCountryCode, getFlagEmoji, getKYCRequirements, deriveNumberType, DOCUMENT_LABELS, COUNTRY_NAME_TO_CODE } = require("../utils/didCountryData");

function applyMargin(basePrice, marginPercent) {
  return parseFloat((basePrice * (1 + marginPercent / 100)).toFixed(4));
}

async function getMargins() {
  const settings = await DIDLogicSettings.findOne({ key: "global" }).lean();
  return {
    numberMargin: settings?.numberMarginPercent ?? 0,
    callMargin: settings?.callMarginPercent ?? 0,
  };
}

async function resolveCompanyAdminId(req) {
  if (req.user.role === "user" && req.user.createdByWhichCompanyAdmin) {
    return req.user.createdByWhichCompanyAdmin;
  }
  return req.user._id;
}

// ── GET /didlogic/numbers/countries ──────────────────────────────────────────
// Returns ALL countries from DIDLogic API, merged with local available inventory
const getAvailableCountries = async (req, res) => {
  try {
    // 1. Fetch all locally available numbers to get count/price per country
    const localNumbers = await DIDAssignment.find({ status: "available" }).lean();
    const localCountryMap = {};
    for (const n of localNumbers) {
      const key = n.countryName || "Unknown";
      if (!localCountryMap[key]) {
        localCountryMap[key] = { types: new Set(), count: 0, lowestPrice: Infinity };
      }
      localCountryMap[key].types.add(n.numberType || deriveNumberType(n.area));
      localCountryMap[key].count += 1;
      if ((n.ourMonthlyPrice || 0) < localCountryMap[key].lowestPrice) {
        localCountryMap[key].lowestPrice = n.ourMonthlyPrice || 0;
      }
    }

    // 2. Try to fetch all countries from DIDLogic API
    let apiCountries = [];
    try {
      const apiRes = await did.getAllCountries();
      // DIDLogic v2 response may be { data: [...] } or { countries: [...] } or array directly
      const raw = apiRes?.data || apiRes?.countries || (Array.isArray(apiRes) ? apiRes : []);
      apiCountries = raw;
    } catch (apiErr) {
      console.warn("DIDLogic API countries fetch failed, using local DB only:", apiErr.message);
    }

    // 3. Build merged country map — start with API countries
    const countryMap = {};

    for (const c of apiCountries) {
      // DIDLogic may return country/country_name/name fields
      const name = c.country || c.country_name || c.name || "";
      if (!name) continue;
      const code = c.country_code || c.code || getCountryCode(name) || null;
      const flag = code ? getFlagEmoji(code) : "🌐";
      const local = localCountryMap[name] || null;
      countryMap[name] = {
        countryName: name,
        countryCode: code,
        flag,
        types: local ? Array.from(local.types) : [],
        count: local ? local.count : 0,
        lowestPrice: local && local.lowestPrice !== Infinity ? local.lowestPrice : 0,
        hasLocalInventory: !!local,
      };
    }

    // 4. Also include any locally-tracked countries not in API response
    for (const [name, local] of Object.entries(localCountryMap)) {
      if (!countryMap[name]) {
        const code = getCountryCode(name);
        countryMap[name] = {
          countryName: name,
          countryCode: code,
          flag: getFlagEmoji(code),
          types: Array.from(local.types),
          count: local.count,
          lowestPrice: local.lowestPrice !== Infinity ? local.lowestPrice : 0,
          hasLocalInventory: true,
        };
      }
    }

    // 5. If API returned nothing and local is also empty, fall back to known country list
    if (Object.keys(countryMap).length === 0) {
      for (const [name, code] of Object.entries(COUNTRY_NAME_TO_CODE)) {
        countryMap[name] = {
          countryName: name,
          countryCode: code,
          flag: getFlagEmoji(code),
          types: [],
          count: 0,
          lowestPrice: 0,
          hasLocalInventory: false,
        };
      }
    }

    const countries = Object.values(countryMap).sort((a, b) => a.countryName.localeCompare(b.countryName));

    res.json({ success: true, data: countries });
  } catch (err) {
    console.error("getAvailableCountries error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /didlogic/numbers/browse?country=Finland&numberType=local ─────────────
const browseNumbers = async (req, res) => {
  try {
    const { country, numberType, search, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = { status: "available" };
    if (country) filter.countryName = country;
    if (numberType) filter.numberType = numberType;
    if (search) filter.number = { $regex: search, $options: "i" };

    const [numbers, total] = await Promise.all([
      DIDAssignment.find(filter).sort({ number: 1 }).skip(skip).limit(parseInt(limit)).lean(),
      DIDAssignment.countDocuments(filter),
    ]);

    // Attach KYC requirement info
    const kyc = country ? getKYCRequirements(country) : { required: false };

    res.json({ success: true, data: numbers, total, kyc });
  } catch (err) {
    console.error("browseNumbers error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /didlogic/numbers/kyc-requirements?country=Finland ───────────────────
const getKYCInfo = async (req, res) => {
  try {
    const { country } = req.query;
    if (!country) return res.status(400).json({ success: false, message: "country is required" });

    const requirements = getKYCRequirements(country);
    const docLabels = {};
    (requirements.documents || []).forEach((d) => { docLabels[d] = DOCUMENT_LABELS[d] || d; });

    res.json({ success: true, data: { ...requirements, documentLabels: docLabels } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /didlogic/numbers/buy ────────────────────────────────────────────────
const buyNumber = async (req, res) => {
  try {
    const { number } = req.body;
    if (!number) return res.status(400).json({ success: false, message: "number is required" });

    const companyAdminId = await resolveCompanyAdminId(req);

    const assignment = await DIDAssignment.findOne({ number, status: "available" });
    if (!assignment) {
      return res.status(404).json({ success: false, message: "Number is not available or already assigned." });
    }

    const user = await User.findById(companyAdminId).select("creditBalance");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const price = assignment.ourMonthlyPrice;
    if ((user.creditBalance || 0) < price) {
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. You need $${price.toFixed(2)} but have $${(user.creditBalance || 0).toFixed(2)}.`,
      });
    }

    // Deduct credits and assign
    await User.findByIdAndUpdate(companyAdminId, { $inc: { creditBalance: -price } });
    await DIDAssignment.findByIdAndUpdate(assignment._id, {
      status: "assigned",
      companyAdminId,
      assignedAt: new Date(),
    });

    // Record DID transaction for billing history
    await DIDTransaction.create({
      userId: companyAdminId,
      type: "number_purchase",
      amount: price,
      description: `DID number purchase: +${number}`,
      number,
      countryName: assignment.countryName || "",
      didAssignmentId: assignment._id,
      status: "completed",
    });

    const updated = await User.findById(companyAdminId).select("creditBalance");

    res.json({
      success: true,
      message: `Number +${number} assigned to your account.`,
      creditBalance: updated.creditBalance,
      number,
      ourPrice: price,
    });
  } catch (err) {
    console.error("buyNumber error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /didlogic/numbers/my ──────────────────────────────────────────────────
const getMyNumbers = async (req, res) => {
  try {
    const companyAdminId = await resolveCompanyAdminId(req);
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [numbers, total] = await Promise.all([
      DIDAssignment.find({ companyAdminId, status: "assigned" })
        .populate("assignedAgentId", "firstname lastname email")
        .sort({ assignedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      DIDAssignment.countDocuments({ companyAdminId, status: "assigned" }),
    ]);

    res.json({ success: true, data: numbers, total });
  } catch (err) {
    console.error("getMyNumbers error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /didlogic/numbers/my/:id/assign ──────────────────────────────────────
// Admin assigns a purchased number to one of their agents
const assignNumberToAgent = async (req, res) => {
  try {
    const companyAdminId = await resolveCompanyAdminId(req);
    const { agentId } = req.body;

    const record = await DIDAssignment.findOne({ _id: req.params.id, companyAdminId, status: "assigned" });
    if (!record) return res.status(404).json({ success: false, message: "Number not found in your account." });

    if (!agentId) {
      // Unassign from agent
      await DIDAssignment.findByIdAndUpdate(record._id, {
        assignedAgentId: null,
        assignedAgentAt: null,
      });
      return res.json({ success: true, message: "Number unassigned from agent." });
    }

    // Verify the agent belongs to this company admin
    const agent = await User.findOne({
      _id: agentId,
      createdByWhichCompanyAdmin: companyAdminId,
      role: "user",
    }).select("firstname lastname email");
    if (!agent) return res.status(404).json({ success: false, message: "Agent not found." });

    await DIDAssignment.findByIdAndUpdate(record._id, {
      assignedAgentId: agentId,
      assignedAgentAt: new Date(),
    });

    res.json({
      success: true,
      message: `Number +${record.number} assigned to ${agent.firstname} ${agent.lastname}.`,
      agent: { _id: agent._id, firstname: agent.firstname, lastname: agent.lastname, email: agent.email },
    });
  } catch (err) {
    console.error("assignNumberToAgent error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /didlogic/numbers/agents ─────────────────────────────────────────────
// Returns agents belonging to this company admin (for the assign dropdown)
const getMyAgents = async (req, res) => {
  try {
    const companyAdminId = await resolveCompanyAdminId(req);
    const agents = await User.find({
      createdByWhichCompanyAdmin: companyAdminId,
      role: "user",
    })
      .select("firstname lastname email")
      .sort({ firstname: 1 })
      .lean();
    res.json({ success: true, data: agents });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /didlogic/numbers/my/:id ──────────────────────────────────────────
const releaseNumber = async (req, res) => {
  try {
    const companyAdminId = await resolveCompanyAdminId(req);
    const record = await DIDAssignment.findOne({ _id: req.params.id, companyAdminId, status: "assigned" });
    if (!record) return res.status(404).json({ success: false, message: "Assignment not found." });

    await DIDAssignment.findByIdAndUpdate(record._id, {
      status: "available",
      companyAdminId: null,
      assignedAt: null,
      assignedAgentId: null,
      assignedAgentAt: null,
    });

    res.json({ success: true, message: `Number +${record.number} released.` });
  } catch (err) {
    console.error("releaseNumber error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /didlogic/call-records ─────────────────────────────────────────────────
const getCallRecords = async (req, res) => {
  try {
    const companyAdminId = await resolveCompanyAdminId(req);
    const { from, to, page = 1, perPage = 100 } = req.query;
    const { callMargin } = await getMargins();

    const myNumbers = await DIDAssignment.find({ companyAdminId, status: "assigned" })
      .select("number").lean();
    const myNumberSet = new Set(myNumbers.map((n) => n.number));

    const result = await did.getCallRecords({ from, to, page, perPage });
    const calls = (result.calls || [])
      .filter((r) => myNumberSet.size === 0 || myNumberSet.has(r.from))
      .map((r) => ({
        ...r,
        ourCost: applyMargin(r.amount || 0, callMargin),
      }));

    res.json({ success: true, data: calls, pagination: result.pagination || {} });
  } catch (err) {
    console.error("getCallRecords error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /didlogic/transactions ────────────────────────────────────────────────
const getDIDTransactions = async (req, res) => {
  try {
    const companyAdminId = await resolveCompanyAdminId(req);
    const { type, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = { userId: companyAdminId };
    if (type) filter.type = type;

    const [transactions, total] = await Promise.all([
      DIDTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      DIDTransaction.countDocuments(filter),
    ]);

    res.json({ success: true, data: transactions, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getAvailableCountries,
  browseNumbers,
  getKYCInfo,
  buyNumber,
  getMyNumbers,
  assignNumberToAgent,
  getMyAgents,
  releaseNumber,
  getCallRecords,
  getDIDTransactions,
};
