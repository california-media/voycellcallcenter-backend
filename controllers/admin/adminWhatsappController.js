/**
 * SuperAdmin WhatsApp Campaign Controller
 *
 * Same flow as sendTemplateBulkMessage but recipients come from
 * companyAdmin / agent User records instead of contacts/leads.
 * The superAdmin must have their own whatsappWaba connected.
 */

const mongoose = require("mongoose");
const axios = require("axios");
const User = require("../../models/userModel");
const WabaTemplate = require("../../models/wabaTemplateModel");
const WhatsAppMessage = require("../../models/whatsappMessage");
const { META_GRAPH_URL } = require("../../config/whatsapp");
const { createCampaignSchedule } = require("../../services/awsScheduler");

// ─── helpers (mirror of whatsapp.controller.js) ──────────────────────────────

function buildComponents(template, params = {}) {
  const components = [];

  const header = template.components.find(c => c.type === "HEADER");
  if (header) {
    if (header.format === "TEXT" && /{{.*?}}/.test(header.text || "") && params.header) {
      components.push({ type: "header", parameters: [{ type: "text", text: params.header }] });
    }
    if (header.format === "IMAGE" && header.media?.s3Url) {
      components.push({ type: "header", parameters: [{ type: "image", image: { link: header.media.s3Url } }] });
    }
    if (header.format === "VIDEO" && header.media?.s3Url) {
      components.push({ type: "header", parameters: [{ type: "video", video: { link: header.media.s3Url } }] });
    }
    if (header.format === "DOCUMENT" && header.media?.s3Url) {
      components.push({ type: "header", parameters: [{ type: "document", document: { link: header.media.s3Url, filename: header.media.fileName || "file" } }] });
    }
  }

  const body = template.components.find(c => c.type === "BODY");
  if (body && /{{.*?}}/.test(body.text || "")) {
    if (template.parameter_format === "named") {
      const namedExamples = body.example?.body_text_named_params || [];
      components.push({
        type: "body",
        parameters: namedExamples.map((ex, i) => ({
          type: "text", parameter_name: ex.param_name, text: params.body?.[i] || ""
        }))
      });
    } else {
      components.push({
        type: "body",
        parameters: (params.body || []).map(t => ({ type: "text", text: t }))
      });
    }
  }

  const buttons = template.components.find(c => c.type === "BUTTONS");
  if (buttons?.buttons?.length) {
    buttons.buttons.forEach((btn, index) => {
      if (btn.type === "QUICK_REPLY") {
        components.push({ type: "button", sub_type: "quick_reply", index, parameters: [{ type: "payload", payload: btn.text }] });
      }
      if (btn.type === "URL" && /{{.*?}}/.test(btn.url || "") && params.buttons?.[index]) {
        components.push({ type: "button", sub_type: "url", index, parameters: [{ type: "text", text: params.buttons[index] }] });
      }
      if (btn.type === "COPY_CODE" && params.buttons?.[index]) {
        components.push({ type: "button", sub_type: "copy_code", index, parameters: [{ type: "coupon_code", coupon_code: params.buttons[index] }] });
      }
      if (btn.type === "PHONE_NUMBER") {
        components.push({ type: "button", sub_type: "voice_call", index });
      }
    });
  }

  return components;
}

// Fetch recipients (phone numbers) from User model based on target mode
async function resolveRecipients(target, targetCompanyIds = []) {
  let query = {};
  if (target === "specific") {
    if (!targetCompanyIds.length) throw new Error("targetCompanyIds required for specific target");
    query = { _id: { $in: targetCompanyIds }, role: "companyAdmin" };
  } else if (target === "companies") {
    query = { role: "companyAdmin" };
  } else {
    // all — companyAdmins + agents
    query = { role: { $in: ["companyAdmin", "user"] } };
  }

  const users = await User.find(query).select("firstname lastname email phonenumbers telephone role").lean();

  const recipients = [];
  users.forEach(u => {
    const name = [u.firstname, u.lastname].filter(Boolean).join(" ") || u.email;
    if (u.phonenumbers?.length) {
      u.phonenumbers.forEach(p => {
        if (p.number) {
          recipients.push({ name, number: `${p.countryCode || ""}${p.number}` });
        }
      });
    } else if (u.telephone) {
      recipients.push({ name, number: u.telephone });
    }
  });

  // deduplicate by number
  const seen = new Set();
  return recipients.filter(r => {
    if (seen.has(r.number)) return false;
    seen.add(r.number);
    return true;
  });
}

// ─── POST /superAdmin/whatsapp/send-campaign ─────────────────────────────────
exports.sendAdminCampaign = async (req, res) => {
  try {
    const adminId = req.user._id;
    const { campaignName, templateId, params = {}, schedule = "", target = "all", targetCompanyIds = [], excelNumbers = [] } = req.body;

    if (!campaignName) return res.status(400).json({ success: false, message: "campaignName is required" });
    if (!templateId) return res.status(400).json({ success: false, message: "templateId is required" });

    const admin = await User.findById(adminId);
    if (!admin?.whatsappWaba) return res.status(400).json({ success: false, message: "WhatsApp WABA not connected for superAdmin account" });

    const { phoneNumberId, accessToken } = admin.whatsappWaba;

    const template = await WabaTemplate.findById(templateId);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });

    let recipients;
    if (target === "excel") {
      if (!Array.isArray(excelNumbers) || !excelNumbers.length) {
        return res.status(400).json({ success: false, message: "excelNumbers is required when target is 'excel'" });
      }
      const seen = new Set();
      recipients = excelNumbers
        .map(row => {
          const raw = String(row.number || "").replace(/[^0-9]/g, "");
          if (!raw || raw.length < 7) return null;
          const nameParts = (row.name || "").trim().split(" ");
          return { number: raw, name: row.name || raw, firstName: nameParts[0] || "", lastName: nameParts.slice(1).join(" ") || "" };
        })
        .filter(r => {
          if (!r || seen.has(r.number)) return false;
          seen.add(r.number);
          return true;
        });
    } else {
      recipients = await resolveRecipients(target, targetCompanyIds);
    }
    if (!recipients.length) return res.status(400).json({ success: false, message: "No phone numbers found for the selected target" });

    const campaignId = new mongoose.Types.ObjectId();
    const campaignData = {
      campaignId,
      campaignName,
      templateId: template._id,
      templateName: template.name,
      status: schedule ? "scheduled" : "completed",
      templateLanguage: template.language,
      groups: [],
      numbers: recipients,
      total: recipients.length,
      messageRefs: [],
      scheduledAt: schedule ? new Date(schedule) : null,
      target,
      targetCompanyIds,
    };

    const components = buildComponents(template, params);

    // Schedule mode
    if (schedule) {
      await User.updateOne({ _id: adminId }, { $push: { campaigns: campaignData } });
      const isoTime = schedule.replace(/\.\d{3}Z$/, "Z");
      await createCampaignSchedule({
        campaignId: campaignId.toString(),
        scheduleTime: isoTime,
        payload: {
          type: "SEND_SCHEDULED_CAMPAIGN",
          campaignId: campaignId.toString(),
          userId: adminId.toString(),
          templateId: templateId.toString(),
          params,
          scheduledAt: new Date(schedule),
        },
      });
      return res.json({ success: true, message: "Campaign scheduled successfully", campaignId, scheduledAt: isoTime });
    }

    // Immediate bulk send
    const results = [];
    for (const r of recipients) {
      const msgPayload = {
        messaging_product: "whatsapp",
        to: r.number,
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language || "en_US" },
          ...(components.length && { components }),
        },
      };

      let metaMessageId = null;
      let sendSuccess = false;

      try {
        const metaRes = await axios.post(
          `${META_GRAPH_URL}/${phoneNumberId}/messages`,
          msgPayload,
          { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
        );
        metaMessageId = metaRes.data?.messages?.[0]?.id;
        sendSuccess = true;
        results.push({ number: r.number, success: true, metaMessageId });
      } catch (err) {
        results.push({ number: r.number, success: false, error: err.response?.data || err.message });
      }

      // Save WhatsApp message to DB using the same schema as companyAdmin
      try {
        await WhatsAppMessage.create({
          userId: adminId,
          phoneNumberId,
          conversationId: r.number,
          senderName: r.name,
          direction: "outgoing",
          from: phoneNumberId,
          to: r.number,
          messageType: "template",
          content: {
            template: {
              name: template.name,
              language: template.language,
              components: template.components,
            }
          },
          metaMessageId,
          status: sendSuccess ? "sent" : "failed",
          messageTimestamp: new Date(),
        });
      } catch (dbErr) {
        console.error("Failed to save WhatsAppMessage for admin campaign:", dbErr.message);
      }

      // Store ref (no status — live status comes from WhatsAppMessage docs)
      campaignData.messageRefs.push({
        metaMessageId,
        chatNumber: r.number,
        chatName: r.name,
      });
    }

    await User.updateOne({ _id: adminId }, { $push: { campaigns: campaignData } });

    return res.json({ success: true, message: `Campaign sent to ${results.filter(r => r.success).length}/${recipients.length} recipients`, campaignId });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /superAdmin/whatsapp/campaigns ─────────────────────────────────────
exports.getAdminCampaigns = async (req, res) => {
  try {
    const adminId = req.user._id;
    const { page = 1, limit = 10, search = "" } = req.body;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const admin = await User.findById(adminId).lean();
    let campaigns = admin?.campaigns || [];

    if (search) {
      const q = search.toLowerCase();
      campaigns = campaigns.filter(c =>
        (c.campaignName || "").toLowerCase().includes(q) ||
        (c.templateName || "").toLowerCase().includes(q)
      );
    }

    const total = campaigns.length;
    const paginated = [...campaigns].reverse().slice(skip, skip + parseInt(limit));

    return res.json({ success: true, campaigns: paginated, count: total });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─── POST /superAdmin/whatsapp/campaignsById ─────────────────────────────────
exports.getAdminCampaignById = async (req, res) => {
  try {
    const adminId = req.user._id;
    const { campaignId } = req.body;

    const admin = await User.findById(adminId).lean();
    const campaign = admin?.campaigns?.find(c => c.campaignId?.toString() === campaignId);
    if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });

    const messageRefs = campaign.messageRefs || [];

    // Fetch live status from WhatsAppMessage docs (same approach as getCampaignDetails)
    const metaMessageIds = messageRefs.map(r => r.metaMessageId).filter(Boolean);
    const waMsgs = await WhatsAppMessage.find({ metaMessageId: { $in: metaMessageIds } }).lean();
    const msgMap = {};
    waMsgs.forEach(m => { msgMap[m.metaMessageId] = m; });

    // Build per-recipient message list with live status + timestamps
    const messages = messageRefs.map(ref => {
      const doc = msgMap[ref.metaMessageId];
      return {
        metaMessageId: ref.metaMessageId,
        chatNumber: ref.chatNumber,
        chatName: ref.chatName || ref.chatNumber,
        status: doc?.status || (ref.metaMessageId ? "sent" : "failed"),
        sentAt: doc?.messageSentTimestamp || doc?.messageTimestamp || null,
        deliveredAt: doc?.messageDeliveredTimestamp || null,
        readAt: doc?.messageReadTimestamp || null,
      };
    });

    // Cumulative stats (same logic as getCampaignDetails)
    const total = messageRefs.length;
    let sent = 0, delivered = 0, read = 0, failed = 0;
    messages.forEach(m => {
      if (m.status === "failed") { failed++; return; }
      sent++;
      if (m.status === "delivered" || m.status === "read") delivered++;
      if (m.status === "read") read++;
    });

    return res.json({
      success: true,
      campaign,
      messages,
      stats: { total, sent, delivered, read, failed },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
