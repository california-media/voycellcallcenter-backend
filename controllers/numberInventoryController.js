const did = require("../services/didlogicService");
const DIDAssignment = require("../models/DIDAssignment");
const DIDTransaction = require("../models/DIDTransaction");
const DIDLogicSettings = require("../models/DIDLogicSettings");
const User = require("../models/userModel");
const { getFlagEmoji, getKYCRequirements } = require("../utils/didCountryData");

function applyMargin(basePrice, marginPercent) {
  return parseFloat((basePrice * (1 + marginPercent / 100)).toFixed(4));
}

async function resolveCompanyAdminId(req) {
  if (req.user.role === "user" && req.user.createdByWhichCompanyAdmin) {
    return req.user.createdByWhichCompanyAdmin;
  }
  return req.user._id;
}

// ── GET /didlogic/inventory/countries ────────────────────────────────────────
// Returns: { countries: [{ id, name, short_name, has_provinces_or_states, flag }] }
const getCountries = async (req, res) => {
  try {
    const result = await did.getAllCountries();
    // DIDLogic returns { countries: [...] }
    const raw = result?.countries || result?.data || (Array.isArray(result) ? result : []);

    const countries = raw.map((c) => ({
      ...c,
      flag: c.short_name ? getFlagEmoji(c.short_name) : "🌐",
    }));

    res.json({ success: true, data: countries });
  } catch (err) {
    console.error("getCountries error:", err.message);
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── GET /didlogic/inventory/countries/:country_id/regions ────────────────────
const getRegions = async (req, res) => {
  try {
    const result = await did.getRegionsForCountry(req.params.country_id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── GET /didlogic/inventory/countries/:country_id/cities ─────────────────────
const getCities = async (req, res) => {
  try {
    const result = await did.getCitiesForCountry(req.params.country_id, req.query);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── GET /didlogic/inventory/countries/:country_id/locations ──────────────────
const getLocations = async (req, res) => {
  try {
    const { prefix } = req.query;
    const result = await did.getLocationsForCountry(req.params.country_id, prefix);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── GET /didlogic/inventory/countries/:country_id/cities/:city_id/numbers ────
const getNumbersByCity = async (req, res) => {
  try {
    const { country_id, city_id } = req.params;
    const { page = 1, per_page = 25 } = req.query;

    const settings = await DIDLogicSettings.findOne({ key: "global" }).lean();
    const margin           = settings?.numberMarginPercent     ?? 0;
    const activationMargin = settings?.activationMarginPercent ?? 0;
    const callMargin       = settings?.callMarginPercent       ?? 0;

    const result = await did.getNumbersByCity(country_id, city_id, { page, per_page });

    console.log("[getNumbersByCity] raw keys:", Object.keys(result || {}),
      "| dids type:", typeof result?.dids,
      "| isArray:", Array.isArray(result?.dids));

    // DIDLogic may return flat { dids: [] } or nested { dids: { pagination, dids: [] } }
    // Use the same defensive unwrapping as searchNumbers to handle both shapes.
    const didsWrapper = result?.dids;
    let raw, pagination;

    if (didsWrapper && typeof didsWrapper === "object" && !Array.isArray(didsWrapper) && Array.isArray(didsWrapper.dids)) {
      // Nested shape: { dids: { pagination, dids: [] } }
      raw        = didsWrapper.dids;
      pagination = didsWrapper.pagination || null;
    } else if (Array.isArray(didsWrapper)) {
      // Flat shape: { dids: [] }
      raw        = didsWrapper;
      pagination = result?.pagination || null;
    } else {
      // Fallback
      raw        = result?.data || (Array.isArray(result) ? result : []);
      pagination = result?.pagination || null;
    }

    console.log("[getNumbersByCity] resolved", raw.length, "DIDs, pagination:", pagination);

    const dids = raw.map((d) => {
      const baseMonthly    = d.monthly_fee ?? d.monthly ?? 0;
      const baseActivation = d.activation  ?? 0;
      const basePerMinute  = d.per_minute  ?? 0;
      return {
        ...d,
        monthly_fee:        baseMonthly,
        ourMonthlyPrice:    applyMargin(baseMonthly,    margin),
        ourActivationPrice: applyMargin(baseActivation, activationMargin),
        ourPerMinute:       applyMargin(basePerMinute,  callMargin),
        marginPercent:      margin,
      };
    });

    const total = pagination?.total ?? result?.total ?? result?.count ?? dids.length;

    // Get country name from first DID for KYC lookup
    const countryName = dids[0]?.country || "";
    const kyc = countryName ? getKYCRequirements(countryName) : { required: false };

    res.json({
      success: true,
      data: dids,
      total,
      pagination,
      kyc,
    });
  } catch (err) {
    console.error("getNumbersByCity error:", err.message);
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── GET /didlogic/inventory/search ───────────────────────────────────────────
// Proxies to: GET https://app.didlogic.com/api/v2/numbers/search
// Supported params: country_name_contains, number_type, pattern, page, per_page
//
// DIDLogic search response shape:
//   { dids: { pagination: { total, total_pages, current_page }, dids: [...] } }
//
const searchNumbers = async (req, res) => {
  try {
    const settings = await DIDLogicSettings.findOne({ key: "global" }).lean();
    const margin = settings?.numberMarginPercent ?? 0;

    // Strip out any empty / undefined params so DIDLogic doesn't reject them
    const cleanParams = Object.fromEntries(
      Object.entries(req.query).filter(([, v]) => v !== "" && v !== undefined && v !== null)
    );

    console.log("[numberInventory/search] → DIDLogic params:", cleanParams);

    const result = await did.searchNumbers(cleanParams);

    console.log("[numberInventory/search] ← DIDLogic raw keys:", Object.keys(result || {}));

    // DIDLogic search wraps results: { dids: { pagination: {...}, dids: [...] } }
    // Handle both that shape AND a flat { dids: [...] } or { data: [...] } response
    const didsWrapper = result?.dids;
    let raw;
    let pagination;

    if (didsWrapper && typeof didsWrapper === "object" && !Array.isArray(didsWrapper) && didsWrapper.dids) {
      // Nested shape: { dids: { pagination, dids: [] } }
      raw        = didsWrapper.dids;
      pagination = didsWrapper.pagination || null;
    } else if (Array.isArray(didsWrapper)) {
      // Flat shape: { dids: [...] }
      raw        = didsWrapper;
      pagination = result?.pagination || null;
    } else {
      // Fallback
      raw        = result?.data || (Array.isArray(result) ? result : []);
      pagination = result?.pagination || null;
    }

    const activationMargin = settings?.activationMarginPercent ?? 0;
    const callMargin       = settings?.callMarginPercent ?? 0;

    const dids = raw.map((d) => {
      const baseMonthly    = d.monthly_fee  ?? d.monthly    ?? 0;
      const baseActivation = d.activation   ?? 0;
      const basePerMinute  = d.per_minute   ?? 0;
      return {
        ...d,
        // Normalize field names (search API uses 'monthly', city API uses 'monthly_fee')
        monthly_fee:        baseMonthly,
        // Margin-adjusted prices sent to the frontend
        ourMonthlyPrice:    applyMargin(baseMonthly,    margin),
        ourActivationPrice: applyMargin(baseActivation, activationMargin),
        ourPerMinute:       applyMargin(basePerMinute,  callMargin),
      };
    });

    const total = pagination?.total ?? result?.total ?? result?.count ?? dids.length;

    res.json({
      success: true,
      data: dids,
      total,
      pagination,
    });
  } catch (err) {
    const didErr = err.response?.data;
    console.error("[numberInventory/search] ERROR:", err.response?.status, didErr || err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      message: didErr?.message || err.message,
      didlogic_error: didErr || null,
    });
  }
};

// ── POST /didlogic/inventory/purchase ────────────────────────────────────────
// Body (from frontend numberInventorySlice):
//   id_in[]       — array with the single DID ID
//   did_numbers[] — array with the single phone number
//   identities[]  — array of { id: identity_id, did_ids: [did_id] }
//   monthly_fee, country, area — kept for internal records / credit deduction
// 1. Calls Provider POST /v2/numbers/purchase (multipart/form-data)
// 2. Deducts credits from company admin
// 3. Creates local DIDAssignment record
const purchaseNumber = async (req, res) => {
  try {
    const companyAdminId = await resolveCompanyAdminId(req);

    // Support both the new array-based payload and the legacy flat payload
    const id_in      = req.body.id_in      || (req.body.did_id      ? [req.body.did_id]  : []);
    const did_numbers= req.body.did_numbers || (req.body.number      ? [req.body.number]  : []);
    const identities = req.body.identities  || [];
    const monthly_fee   = req.body.monthly_fee;
    const activation_fee= req.body.activation_fee;   // provider activation fee
    const channels      = req.body.channels;
    const country       = req.body.country;
    const area          = req.body.area;

    // Derive scalar values for internal DB records
    const did_id      = id_in[0];
    const number      = did_numbers[0];
    const identity_id = identities[0]?.id ?? req.body.identity_id;

    if (!did_id && !number) {
      return res.status(400).json({ success: false, message: "did_id or number is required." });
    }
    if (!identity_id) {
      return res.status(422).json({ success: false, message: "identity_id is required to purchase numbers." });
    }

    // Check company admin credit balance
    const settings  = await DIDLogicSettings.findOne({ key: "global" }).lean();
    const margin    = settings?.numberMarginPercent ?? 0;
    const isTestMode = settings?.isTestMode ?? false;
    const ourPrice  = applyMargin(Number(monthly_fee) || 0, margin);

    const user = await User.findById(companyAdminId).select("creditBalance");
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    if ((user.creditBalance || 0) < ourPrice) {
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. Need $${ourPrice.toFixed(2)}, have $${(user.creditBalance || 0).toFixed(2)}.`,
      });
    }

    // ── Call DIDProvider purchase API ────────────────────────────────────────
    if (isTestMode) {
      console.log(`\n[DIDProvider] 🧪 TEST MODE — purchase SIMULATED (no real API call)`);
      console.log(`[DIDProvider]    Number   : +${number}`);
      console.log(`[DIDProvider]    DID ID   : ${did_id}`);
      console.log(`[DIDProvider]    Identity : ${identity_id}`);
      console.log(`[DIDProvider]    Price    : $${ourPrice.toFixed(2)} (margin ${margin}%)`);
    } else {
      console.log(`\n[DIDProvider] 🚀 LIVE MODE — calling real purchase API`);
      console.log(`[DIDProvider]    Endpoint : POST https://app.didlogic.com/api/v2/numbers/purchase`);
      console.log(`[DIDProvider]    Number   : +${number}`);
      console.log(`[DIDProvider]    DID ID   : ${did_id}`);
      console.log(`[DIDProvider]    Identity : ${identity_id}`);
      console.log(`[DIDProvider]    Price    : $${ourPrice.toFixed(2)} (margin ${margin}%)`);
    }

    // Test mode: DIDProvider has no sandbox, so we simulate a successful response
    // and skip the real API call entirely. Credits are still deducted and the
    // assignment is recorded so the full flow can be tested end-to-end.
    let providerResult;
    if (isTestMode) {
      providerResult = {
        _simulated: true,
        purchase: {
          errors: {},
          purchases: [{
            id:                  Number(did_id),
            number:              String(number),
            sms_enabled:         false,
            no_local_cli:        false,
            channels:            1,
            country:             country  || "Test Country",
            area:                area     || "Test City",
            free_minutes:        0,
            codec:               null,
            require_docs:        "",
            commitment_months:   0,
            activation:          0,
            monthly_fee:         Number(monthly_fee) || 0,
            per_minute:          0,
            origination_per_min: 0,
            never_sold:          1,
          }],
        },
      };
    } else {
      // Live mode — call DIDProvider API with multipart/form-data per API docs
      providerResult = await did.purchaseNumbers({
        id_in:       id_in.map(Number),
        did_numbers: did_numbers.map(String),
        identities,
      });
      console.log(`[DIDProvider] ✅ LIVE purchase response:`, JSON.stringify(providerResult, null, 2));
    }

    // Deduct credits
    await User.findByIdAndUpdate(companyAdminId, { $inc: { creditBalance: -ourPrice } });

    // Create / update local DIDAssignment
    const activationMargin = settings?.activationMarginPercent ?? 0;
    const ourActivation    = applyMargin(Number(activation_fee) || 0, activationMargin);
    await DIDAssignment.findOneAndUpdate(
      { number: String(number) },
      {
        $set: {
          number:             String(number),
          countryName:        country || "",
          area:               area || "",
          numberType:         "local",
          didlogicMonthlyFee: Number(monthly_fee) || 0,
          ourMonthlyPrice:    ourPrice,
          didlogicActivation: Number(activation_fee) || 0,
          ourActivationPrice: ourActivation,
          channels:           Number(channels) || 1,
          marginPercent:      margin,
          companyAdminId,
          status:             "assigned",
          assignedAt:         new Date(),
          assignedAgentId:    null,
          assignedAgentAt:    null,
        },
      },
      { upsert: true, new: true }
    );

    // Record billing transaction
    await DIDTransaction.create({
      userId: companyAdminId,
      type: "number_purchase",
      amount: ourPrice,
      description: `DID number purchase: +${number}`,
      number: String(number),
      countryName: country || "",
      status: "completed",
    });

    const updated = await User.findById(companyAdminId).select("creditBalance");

    res.json({
      success: true,
      message: `Number +${number} purchased successfully.`,
      number,
      ourPrice,
      creditBalance: updated.creditBalance,
      providerResponse: providerResult,
    });
  } catch (err) {
    console.error(`[DIDProvider] ❌ purchaseNumber ERROR:`, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      message: err.response?.data?.message || err.message,
      errors: err.response?.data?.errors || null,
    });
  }
};

// ── GET /didlogic/inventory/token ────────────────────────────────────────────
// Returns the DIDProvider Bearer token so the frontend can call DIDProvider directly
const getApiToken = async (req, res) => {
  try {
    const settings = await DIDLogicSettings.findOne({ key: "global" }).lean();
    const token = settings?.apiToken || process.env.DIDLOGIC_API_TOKEN || "";
    if (!token) {
      return res.status(404).json({ success: false, message: "DIDProvider API token not configured." });
    }
    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /didlogic/inventory/record-purchase ─────────────────────────────────
// Called by the frontend AFTER a successful direct DIDProvider API purchase.
// Handles: credit balance deduction, DIDAssignment upsert, DIDTransaction record.
// Body: { did_id, number, monthly_fee, country, area, identity_id, provider_response }
const recordPurchase = async (req, res) => {
  try {
    const companyAdminId = await resolveCompanyAdminId(req);
    const { number, monthly_fee, country, area, provider_response } = req.body;

    if (!number) {
      return res.status(400).json({ success: false, message: "number is required." });
    }

    const settings = await DIDLogicSettings.findOne({ key: "global" }).lean();
    const margin   = settings?.numberMarginPercent ?? 0;
    const ourPrice = applyMargin(Number(monthly_fee) || 0, margin);

    // Verify and deduct credits
    const user = await User.findById(companyAdminId).select("creditBalance");
    if (!user) return res.status(404).json({ success: false, message: "User not found." });
    if ((user.creditBalance || 0) < ourPrice) {
      return res.status(402).json({
        success: false,
        message: `Insufficient credits. Need $${ourPrice.toFixed(2)}, have $${(user.creditBalance || 0).toFixed(2)}.`,
      });
    }
    await User.findByIdAndUpdate(companyAdminId, { $inc: { creditBalance: -ourPrice } });

    // Upsert DIDAssignment record
    await DIDAssignment.findOneAndUpdate(
      { number: String(number) },
      {
        $set: {
          number:              String(number),
          countryName:         country || "",
          area:                area || "",
          numberType:          "local",
          didlogicMonthlyFee:  Number(monthly_fee) || 0,
          ourMonthlyPrice:     ourPrice,
          marginPercent:       margin,
          companyAdminId,
          status:              "assigned",
          assignedAt:          new Date(),
          assignedAgentId:     null,
          assignedAgentAt:     null,
        },
      },
      { upsert: true, new: true }
    );

    // Record billing transaction
    await DIDTransaction.create({
      userId:      companyAdminId,
      type:        "number_purchase",
      amount:      ourPrice,
      description: `DID number purchase: +${number}`,
      number:      String(number),
      countryName: country || "",
      status:      "completed",
    });

    const updated = await User.findById(companyAdminId).select("creditBalance");

    res.json({
      success:         true,
      message:         `Number +${number} purchase recorded successfully.`,
      number,
      ourPrice,
      creditBalance:   updated.creditBalance,
      providerResponse: provider_response || null,
    });
  } catch (err) {
    console.error("recordPurchase error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getCountries,
  getRegions,
  getCities,
  getLocations,
  getNumbersByCity,
  searchNumbers,
  purchaseNumber,
  getApiToken,
  recordPurchase,
};
