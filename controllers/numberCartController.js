const NumberCart      = require("../models/NumberCart");
const DIDLogicSettings = require("../models/DIDLogicSettings");

function applyMargin(base, pct) {
  return parseFloat((base * (1 + pct / 100)).toFixed(4));
}

/** Resolve the real userId (for agents → use their own ID; cart is per-login user) */
function resolveUserId(req) {
  return req.user._id;
}

// ── GET /didlogic/cart ────────────────────────────────────────────────────────
// Always recalculates ourMonthlyPrice / ourActivationPrice / ourPerMinute from
// the CURRENT margin settings so that changes to commissions are reflected immediately.
const getCart = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    const [cart, settings] = await Promise.all([
      NumberCart.findOne({ userId }).lean(),
      DIDLogicSettings.findOne({ key: "global" }).lean(),
    ]);

    const numberMargin     = settings?.numberMarginPercent     ?? 0;
    const activationMargin = settings?.activationMarginPercent ?? 0;
    const callMargin       = settings?.callMarginPercent       ?? 0;

    const items = (cart?.items || []).map((item) => ({
      ...item,
      ourMonthlyPrice:    applyMargin(item.monthly_fee  || 0, numberMargin),
      ourActivationPrice: applyMargin(item.activation   || 0, activationMargin),
      ourPerMinute:       applyMargin(item.per_minute   || 0, callMargin),
    }));

    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /didlogic/cart/add ───────────────────────────────────────────────────
// Body: full DID object from the search results (did_id, number, country, …)
const addToCart = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    const {
      did_id, number, country, country_short_name, city, channels,
      activation, monthly_fee, per_minute,
      ourActivationPrice, ourMonthlyPrice, ourPerMinute,
      required_documents,
    } = req.body;

    if (!did_id || !number) {
      return res.status(400).json({ success: false, message: "did_id and number are required." });
    }

    // Upsert the cart document; push item only if not already present (by did_id)
    const existing = await NumberCart.findOne({ userId, "items.did_id": did_id });
    if (existing) {
      return res.status(409).json({ success: false, message: "Number already in cart." });
    }

    // Store raw DIDLogic prices only — our* prices are recalculated on every GET
    // so commission changes are always reflected immediately
    const item = {
      did_id:             Number(did_id),
      number:             String(number),
      country:            country || "",
      country_short_name: country_short_name || "",
      city:               city || "",
      channels:           channels || 1,
      activation:         Number(activation)  || 0,   // raw DIDLogic price
      monthly_fee:        Number(monthly_fee) || 0,   // raw DIDLogic price
      per_minute:         Number(per_minute)  || 0,   // raw DIDLogic price
      required_documents: Array.isArray(required_documents) ? required_documents : [],
      addedAt: new Date(),
    };

    const cart = await NumberCart.findOneAndUpdate(
      { userId },
      { $push: { items: item } },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Number added to cart.", data: cart.items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /didlogic/cart/remove/:did_id ─────────────────────────────────────
const removeFromCart = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    const didId  = Number(req.params.did_id);

    await NumberCart.findOneAndUpdate(
      { userId },
      { $pull: { items: { did_id: didId } } }
    );

    // Return recalculated items (reuse getCart logic)
    const [cart, settings] = await Promise.all([
      NumberCart.findOne({ userId }).lean(),
      DIDLogicSettings.findOne({ key: "global" }).lean(),
    ]);
    const numberMargin     = settings?.numberMarginPercent     ?? 0;
    const activationMargin = settings?.activationMarginPercent ?? 0;
    const callMargin       = settings?.callMarginPercent       ?? 0;
    const items = (cart?.items || []).map((item) => ({
      ...item,
      ourMonthlyPrice:    applyMargin(item.monthly_fee || 0, numberMargin),
      ourActivationPrice: applyMargin(item.activation  || 0, activationMargin),
      ourPerMinute:       applyMargin(item.per_minute  || 0, callMargin),
    }));

    res.json({ success: true, message: "Number removed from cart.", data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /didlogic/cart/clear ───────────────────────────────────────────────
const clearCart = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    await NumberCart.findOneAndUpdate({ userId }, { $set: { items: [] } }, { upsert: true });
    res.json({ success: true, message: "Cart cleared." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /didlogic/cart/remove-purchased ─────────────────────────────────────
// Called after a successful purchase to remove that did_id from the cart
const removePurchasedFromCart = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    const { did_id } = req.body;
    if (!did_id) return res.status(400).json({ success: false, message: "did_id required." });

    await NumberCart.findOneAndUpdate(
      { userId },
      { $pull: { items: { did_id: Number(did_id) } } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getCart, addToCart, removeFromCart, clearCart, removePurchasedFromCart };
