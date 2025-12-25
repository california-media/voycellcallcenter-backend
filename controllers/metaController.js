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
  try {
    const userId = req.user._id.toString();
    const redirectUri = `${process.env.BACKEND_URL}/api/meta/callback`;

    const url =
      `https://www.facebook.com/v19.0/dialog/oauth?` +
      `client_id=${process.env.META_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${userId}` +
      `&response_type=code` +
      `&scope=ads_management,leads_retrieval,pages_read_engagement,pages_show_list`;

    return res.json({ url });
  } catch (error) {
    console.error("connectFacebook error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to generate Facebook OAuth URL"
    });
  }
};

/**
 * =====================================================
 * STEP 2: Facebook OAuth Callback
 * (Called by Facebook — NO AUTH HERE)
 * =====================================================
 */
exports.facebookCallback = async (req, res) => {
  try {
    const { code, state } = req.query; // state = userId

    if (!code || !state) {
      return res.status(400).json({
        status: "error",
        message: "Invalid OAuth callback"
      });
    }

    const redirectUri = `${process.env.BACKEND_URL}/api/meta/callback`;

    // Exchange code for access token
    const tokenRes = await axios.get(
      "https://graph.facebook.com/v19.0/oauth/access_token",
      {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: redirectUri,
          code
        }
      }
    );

    const { access_token, expires_in } = tokenRes.data;

    // Get Facebook profile
    const profileRes = await axios.get(
      "https://graph.facebook.com/me",
      {
        params: {
          access_token,
          fields: "id,name"
        }
      }
    );

    // Save token to correct user (from state)
    await User.findByIdAndUpdate(state, {
      meta: {
        isConnected: true,
        facebookUserId: profileRes.data.id,
        accessToken: access_token,
        tokenExpiresAt: new Date(Date.now() + expires_in * 1000)
      }
    });

    // Redirect to frontend success page
    return res.redirect(
      `${process.env.FRONTEND_URL}/facebook-connected`
    );
  } catch (error) {
    console.error("facebookCallback error:", error.response?.data || error);
    return res.status(500).json({
      status: "error",
      message: "Facebook connection failed"
    });
  }
};

/**
 * =====================================================
 * STEP 3: Fetch Facebook Pages (after connect)
 * =====================================================
 */
exports.getFacebookPages = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user?.meta?.accessToken) {
      return res.status(400).json({
        status: "error",
        message: "Facebook not connected"
      });
    }

    const pagesRes = await axios.get(
      "https://graph.facebook.com/v19.0/me/accounts",
      {
        params: {
          access_token: user.meta.accessToken
        }
      }
    );

    return res.json({
      status: "success",
      pages: pagesRes.data.data
    });
  } catch (error) {
    console.error("getFacebookPages error:", error.response?.data || error);
    return res.status(500).json({
      status: "error",
      message: "Failed to fetch Facebook pages"
    });
  }
};

/**
 * =====================================================
 * STEP 4: Save Selected Page (Page → User mapping)
 * =====================================================
 */
exports.saveFacebookPage = async (req, res) => {
  try {
    const { pageId, pageName, pageAccessToken } = req.body;

    if (!pageId || !pageAccessToken) {
      return res.status(400).json({
        status: "error",
        message: "Page data missing"
      });
    }

    await User.findByIdAndUpdate(req.user._id, {
      $push: {
        "meta.pages": {
          pageId,
          pageName,
          pageAccessToken
        }
      }
    });

    return res.json({
      status: "success",
      message: "Facebook page connected successfully"
    });
  } catch (error) {
    console.error("saveFacebookPage error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to save Facebook page"
    });
  }
};

/**
 * =====================================================
 * STEP 5: Meta Lead Webhook (via Pabbly)
 * (NO AUTH — verified by secret)
 * =====================================================
 */
exports.metaLeadWebhook = async (req, res) => {
  try {
    const { page_id, fields } = req.body;

    if (!page_id || !fields) {
      return res.status(400).json({
        status: "error",
        message: "Invalid webhook payload"
      });
    }

    // Find user by pageId
    const user = await User.findOne({
      "meta.pages.pageId": page_id
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found for this Facebook page"
      });
    }

    const phone = fields.phone_number?.replace(/\D/g, "");
    const email = fields.email?.toLowerCase();

    const { existingPhones, existingEmails } =
      await buildGlobalDuplicateSets(user._id);

    if (
      (phone && existingPhones.has(phone)) ||
      (email && existingEmails.has(email))
    ) {
      return res.json({
        status: "duplicate",
        message: "Lead already exists"
      });
    }

    const [firstname, ...rest] = fields.full_name?.split(" ") || [];

    const lead = await Lead.create({
      firstname: firstname || "",
      lastname: rest.join(" "),
      emailAddresses: email ? [email] : [],
      phoneNumbers: phone
        ? [{ countryCode: "91", number: phone }]
        : [],
      company: fields.company_name || "",
      isLead: true,
      createdBy: user._id,
      source: "Facebook Lead Ads"
    });

    return res.json({
      status: "success",
      isNewLead: true,
      leadId: lead._id
    });
  } catch (error) {
    console.error("metaLeadWebhook error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to process lead"
    });
  }
};
