const axios = require("axios");
const User = require("../models/userModel");
const Lead = require("../models/leadModel");
const { buildGlobalDuplicateSets } = require("../utils/duplicateCheck");

/**
 * =====================================================
 * STEP 1: Generate Facebook OAuth URL
 * (User must be logged in)
 * =====================================================
 */
exports.connectFacebook = async (req, res) => {
  const userId = req.user._id.toString();
  const redirectUri = process.env.META_REDIRECT_URI;

  const authUrl =
    "https://www.facebook.com/v19.0/dialog/oauth" +
    `?client_id=${process.env.META_APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${userId}` +
    `&response_type=code` +
    `&scope=ads_management,leads_retrieval,pages_read_engagement,pages_show_list`;

  return res.json({ authUrl });
};


/**
 * =====================================================
 * STEP 2: Facebook OAuth Callback
 * (Called by Facebook — NO AUTH HERE)
 * =====================================================
 */
exports.facebookCallback = async (req, res) => {
  try {
    const { code, state: userId } = req.query;
    if (!code || !userId) {
      return res.status(400).json({ error: "Invalid callback" });
    }

    const tokenRes = await axios.get(
      "https://graph.facebook.com/v19.0/oauth/access_token",
      {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: process.env.META_REDIRECT_URI,
          code,
        },
      }
    );

    const { access_token } = tokenRes.data;

    // Fetch profile
    const profile = await axios.get(
      "https://graph.facebook.com/me",
      { params: { access_token } }
    );

    await User.findByIdAndUpdate(userId, {
      meta: {
        isConnected: true,
        facebookUserId: profile.data.id,
        accessToken: access_token,
      },
    });

    // ✅ BACKEND RESPONSE (NO REDIRECT)
    return res.json({
      status: "success",
      message: "Facebook connected successfully",
    });
  } catch (err) {
    console.error(err.response?.data || err);
    return res.status(500).json({ error: "OAuth failed" });
  }
};


/**
 * =====================================================
 * STEP 3: Fetch Facebook Pages (after connect)
 * =====================================================
 */
exports.getFacebookPages = async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user?.meta?.accessToken) {
    return res.status(400).json({ error: "Not connected" });
  }

  const pages = await axios.get(
    "https://graph.facebook.com/v19.0/me/accounts",
    {
      params: {
        access_token: user.meta.accessToken,
      },
    }
  );

  return res.json(pages.data.data);
};

/**
 * =====================================================
 * STEP 4: Save Selected Page (Page → User mapping)
 * =====================================================
 */
exports.saveFacebookPage = async (req, res) => {
  const { pageId, pageAccessToken } = req.body;

  await User.findByIdAndUpdate(req.user._id, {
    "meta.pageId": pageId,
    "meta.pageAccessToken": pageAccessToken,
  });

  res.json({ status: "page_saved" });
};


/**
 * =====================================================
 * STEP 5: Meta Lead Webhook (via Pabbly)
 * (NO AUTH — verified by secret)
 * =====================================================
 */
exports.metaLeadWebhook = async (req, res) => {
  const entry = req.body.entry?.[0];
  const change = entry?.changes?.[0];
  const leadgenId = change?.value?.leadgen_id;
  const pageId = change?.value?.page_id;

  const user = await User.findOne({ "meta.pageId": pageId });
  if (!user) return res.sendStatus(200);

  // Fetch lead details
  const leadRes = await axios.get(
    `https://graph.facebook.com/v19.0/${leadgenId}`,
    {
      params: {
        access_token: user.meta.pageAccessToken,
      },
    }
  );

  const fields = leadRes.data.field_data;

  // save lead in DB here

  res.sendStatus(200);
};