/**
 * Waba Flow Engine
 * Executes flow nodes, routes incoming messages, handles timeouts.
 */

const axios = require("axios");
const User = require("../models/userModel");
const WabaFlow = require("../models/WabaFlow");
const WabaFlowSession = require("../models/WabaFlowSession");
const WabaFlowSubmission = require("../models/WabaFlowSubmission");
const WabaBasicReply = require("../models/WabaBasicReply");
const WhatsAppMessage = require("../models/whatsappMessage");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const WsConnection = require("../models/wsConnection");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const flowEngineLambdaClient = new LambdaClient({ region: "eu-north-1" });

const pushWsMessageToUser = async (userId, message) => {
  try {
    const connections = await WsConnection.find({ userId });
    if (!connections.length) { console.log("[pushWs] no active connections for userId:", userId); return; }
    await flowEngineLambdaClient.send(new InvokeCommand({
      FunctionName: "waba-webhook",
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({
        type: "outgoing_message",
        connections: connections.map(c => ({ connectionId: c.connectionId })),
        message,
      })),
    }));
    console.log("[pushWs] Lambda invoked for", connections.length, "connection(s)");
  } catch (e) {
    console.error("[pushWs] Lambda invoke error:", e.message);
  }
};

/* ─────────────────────────────────────────────
   SEND A WHATSAPP MESSAGE via Meta API
───────────────────────────────────────────── */
const sendWabaMessage = async (phoneNumberId, accessToken, to, payload) => {
  const { data } = await axios.post(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    { messaging_product: "whatsapp", recipient_type: "individual", to, ...payload },
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
  );
  return data;
};

/* ─────────────────────────────────────────────
   BUILD META API PAYLOAD FROM NODE DATA
───────────────────────────────────────────── */
const buildPayload = (node) => {
  const d = node.data || {};

  switch (node.type) {
    case "text":
      return { type: "text", text: { body: d.message || "" } };

    case "media": {
      const mediaType = d.mediaType || "image";
      return {
        type: mediaType,
        [mediaType]: { link: d.url, ...(d.caption ? { caption: d.caption } : {}) },
      };
    }

    case "interactiveButtons":
      return {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: d.body || " " },
          action: {
            buttons: (d.buttons || []).map((btn) => ({
              type: "reply",
              reply: { id: btn.id, title: btn.label },
            })),
          },
        },
      };

    case "interactiveList":
      return {
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: d.body || " " },
          action: {
            button: d.buttonLabel || "Choose",
            sections: d.sections || [],
          },
        },
      };

    default:
      return null;
  }
};

/* ─────────────────────────────────────────────
   EXECUTE ACTION NODES (no message sent)
───────────────────────────────────────────── */
const executeActionNode = async (node, session) => {
  const d = node.data || {};

  if (node.type === "delay") return; // handled by scheduler — just move forward

  if (node.type === "addToGroup") {
    const { tagId, tagName } = d;
    if (!tagId) return;
    const Model = await resolveContactModel(session.contactPhone, session.companyAdmin);
    if (Model) {
      await Model.model.findOneAndUpdate(
        { _id: Model.recordId },
        { $addToSet: { tags: { tag_id: tagId, tag: tagName || "", emoji: "🏷️", order: 0, globalOrder: 0 } } }
      );
    }
    return;
  }

  if (node.type === "removeFromGroup") {
    const { tagId } = d;
    if (!tagId) return;
    const Model = await resolveContactModel(session.contactPhone, session.companyAdmin);
    if (Model) {
      await Model.model.findOneAndUpdate(
        { _id: Model.recordId },
        { $pull: { tags: { tag_id: tagId } } }
      );
    }
    return;
  }

  if (node.type === "updateContact") {
    const { field, value } = d;
    if (!field) return;
    const rec = await resolveContactModel(session.contactPhone, session.companyAdmin);
    if (rec) {
      if (field === "status") {
        await rec.model.findOneAndUpdate({ _id: rec.recordId }, { $set: { status: value } });
      } else if (field === "notes") {
        await rec.model.findOneAndUpdate({ _id: rec.recordId }, { $push: { notes: { note: value, createdAt: new Date() } } });
      } else {
        await rec.model.findOneAndUpdate({ _id: rec.recordId }, { $set: { [field]: value } });
      }
    }
    return;
  }

  if (node.type === "sendEmail") {
    // TODO: plug into existing email service if needed
    return;
  }

  if (node.type === "webhook") {
    const { url, method = "POST", headers = {}, body = {} } = d;
    if (url) {
      await axios({ method, url, headers, data: body }).catch(() => {});
    }
    return;
  }
};

/* ─────────────────────────────────────────────
   RESOLVE CONTACT OR LEAD BY PHONE
───────────────────────────────────────────── */
const resolveContactModel = async (phone, companyAdmin) => {
  const digits = phone.replace(/\D/g, "");
  const adminUser = await User.findById(companyAdmin).select("_id");
  const agents = await User.find({ createdByWhichCompanyAdmin: companyAdmin }).select("_id");
  const ownerIds = [adminUser._id, ...agents.map((a) => a._id)];

  const contact = await Contact.findOne({
    createdBy: { $in: ownerIds },
    "phoneNumbers.number": { $regex: digits.slice(-8) },
  });
  if (contact) return { model: Contact, recordId: contact._id, type: "contact" };

  const lead = await Lead.findOne({
    createdBy: { $in: ownerIds },
    "phoneNumbers.number": { $regex: digits.slice(-8) },
  });
  if (lead) return { model: Lead, recordId: lead._id, type: "lead" };

  return null;
};

/* ─────────────────────────────────────────────
   EXECUTE A NODE AND ADVANCE SESSION
───────────────────────────────────────────── */
const executeNode = async (session, flow, userInput) => {
  const node = flow.nodes.find((n) => n.id === session.currentNodeId);
  if (!node) {
    await endSession(session, flow, "completed");
    return;
  }

  const companyAdmin = await User.findById(session.companyAdmin);
  const { phoneNumberId, accessToken } = companyAdmin?.whatsappWaba || {};

  // Send message for message-type nodes
  if (["text", "media", "interactiveButtons", "interactiveList"].includes(node.type)) {
    const payload = buildPayload(node);
    if (payload && phoneNumberId && accessToken) {
      await sendWabaMessage(phoneNumberId, accessToken, session.contactPhone, payload);
    }

    // Store outgoing message
    await WhatsAppMessage.create({
      userId: session.companyAdmin,
      to: session.contactPhone,
      from: phoneNumberId,
      phoneNumberId,
      direction: "outgoing",
      messageType: node.type === "text" ? "text" : "media",
      conversationId: session.contactPhone,
      messageTimestamp: new Date(),
      content: node.data?.message ? { text: node.data.message } : {},
    }).catch(() => {});

    // If this is an interactive node, WAIT for user reply (don't advance yet)
    if (["interactiveButtons", "interactiveList"].includes(node.type)) {
      session.lastActivityAt = new Date();
      await session.save();
      return;
    }

    // For text/media: advance to next node immediately
    await advanceSession(session, flow, node, null);
    return;
  }

  // Action nodes
  if (["delay", "addToGroup", "removeFromGroup", "updateContact", "sendEmail", "webhook"].includes(node.type)) {
    await executeActionNode(node, session);
    await advanceSession(session, flow, node, null);
    return;
  }
};

/* ─────────────────────────────────────────────
   ADVANCE SESSION TO NEXT NODE
   userInput: button id or text (for branching)
───────────────────────────────────────────── */
const advanceSession = async (session, flow, currentNode, userInput) => {
  let nextEdge;

  // Branching: if the current node has outgoing edges with sourceHandle, match by userInput
  const outEdges = flow.edges.filter((e) => e.source === currentNode.id);

  if (outEdges.length === 0) {
    // No next node — flow ends
    await endSession(session, flow, "completed");
    return;
  }

  if (userInput && outEdges.some((e) => e.sourceHandle)) {
    nextEdge = outEdges.find((e) => e.sourceHandle === userInput) || outEdges[0];
  } else {
    nextEdge = outEdges[0];
  }

  const nextNode = flow.nodes.find((n) => n.id === nextEdge.target);
  if (!nextNode) {
    await endSession(session, flow, "completed");
    return;
  }

  session.currentNodeId = nextNode.id;
  session.lastActivityAt = new Date();
  await session.save();

  // Execute next node
  await executeNode(session, flow, null);
};

/* ─────────────────────────────────────────────
   HANDLE INCOMING USER MESSAGE
   Called from webhook handler
───────────────────────────────────────────── */
const handleIncomingMessage = async (companyAdminId, fromPhone, messageType, messageContent) => {
  // 1. Check for active flow session
  const session = await WabaFlowSession.findOne({
    companyAdmin: companyAdminId,
    contactPhone: fromPhone,
    status: "active",
  });

  if (session) {
    const flow = await WabaFlow.findById(session.flow);
    if (!flow) return;

    const currentNode = flow.nodes.find((n) => n.id === session.currentNodeId);

    // Extract user's answer
    let userAnswer = null;
    let buttonId = null;

    if (messageType === "button") {
      userAnswer = messageContent?.button?.text || messageContent?.text;
      buttonId = messageContent?.button?.payload || userAnswer;
    } else if (messageType === "interactive") {
      userAnswer = messageContent?.interactive?.button_reply?.title ||
                   messageContent?.interactive?.list_reply?.title;
      buttonId = messageContent?.interactive?.button_reply?.id ||
                 messageContent?.interactive?.list_reply?.id;
    } else {
      userAnswer = messageContent?.text?.body || messageContent?.text || String(messageContent || "");
    }

    // Save answer to session
    if (currentNode && userAnswer) {
      session.answers.push({
        nodeId: currentNode.id,
        nodeType: currentNode.type,
        question: currentNode.data?.body || currentNode.data?.message || "",
        answer: userAnswer,
        answeredAt: new Date(),
      });
      session.lastActivityAt = new Date();
      await session.save();
    }

    // Advance to next node based on button id (for branching) or just next
    await advanceSession(session, flow, currentNode, buttonId || userAnswer);
    return;
  }

  // 2. No active session — check Basic Replies
  await handleBasicReply(companyAdminId, fromPhone, messageContent);

  // 3. Check if any active flow has a keyword trigger matching this message
  const msgText = messageContent?._msgText || messageContent?.text?.body || messageContent?.text || "";
  if (msgText) {
    await checkFlowKeywordTrigger(companyAdminId, fromPhone, msgText);
  }
};

/* ─────────────────────────────────────────────
   BASIC REPLY HANDLER
───────────────────────────────────────────── */
const handleBasicReply = async (companyAdminId, fromPhone, messageContent) => {
  const msgText = (messageContent?._msgText || messageContent?.text?.body || messageContent?.text || "").trim().toLowerCase();
  console.log(`[basicReply] companyAdminId=${companyAdminId} from=${fromPhone} msgText="${msgText}"`);
  if (!msgText) { console.log("[basicReply] empty msgText — skip"); return; }

  const replies = await WabaBasicReply.find({ companyAdmin: companyAdminId, isActive: true });
  console.log(`[basicReply] found ${replies.length} active rules for companyAdmin ${companyAdminId}`);

  let matched = null;
  for (const reply of replies) {
    const trigger = reply.trigger.trim().toLowerCase();
    console.log(`[basicReply] checking rule "${reply.name}": trigger="${trigger}" criteria="${reply.matchCriteria}"`);
    if (reply.matchCriteria === "exact" && msgText === trigger) { matched = reply; break; }
    if (reply.matchCriteria === "contains" && msgText.includes(trigger)) { matched = reply; break; }
  }

  if (!matched) { console.log(`[basicReply] no rule matched for "${msgText}"`); return; }
  console.log(`[basicReply] matched rule "${matched.name}"`);

  // Check business hours
  if (matched.businessHours?.enabled) {
    const now = new Date();
    const currentDay = now.toLocaleDateString("en-US", { weekday: "short" });
    const currentTime = now.toTimeString().slice(0, 5);
    console.log(`[basicReply] businessHours check: day=${currentDay} time=${currentTime}`);
    if (!matched.businessHours.days.includes(currentDay)) { console.log("[basicReply] outside business days"); return; }
    if (currentTime < matched.businessHours.startTime || currentTime > matched.businessHours.endTime) { console.log("[basicReply] outside business hours"); return; }
  }

  const companyAdmin = await User.findById(companyAdminId);
  const { phoneNumberId, accessToken } = companyAdmin?.whatsappWaba || {};
  console.log(`[basicReply] phoneNumberId=${phoneNumberId} accessToken=${accessToken ? "exists" : "MISSING"}`);
  if (!phoneNumberId || !accessToken) { console.log("[basicReply] missing waba credentials — cannot send"); return; }

  for (const response of matched.responses) {
    let payload;
    if (response.type === "text") {
      payload = { type: "text", text: { body: response.text } };
    } else {
      payload = {
        type: response.type,
        [response.type]: { link: response.mediaUrl, ...(response.caption ? { caption: response.caption } : {}) },
      };
    }
    console.log(`[basicReply] sending response type=${response.type} to ${fromPhone}`);
    try {
      const result = await sendWabaMessage(phoneNumberId, accessToken, fromPhone, payload);
      console.log("[basicReply] sent OK");

      // Save outgoing message to DB so it appears in chat
      const metaMessageId = result?.messages?.[0]?.id || null;
      await WhatsAppMessage.create({
        userId: companyAdminId,
        phoneNumberId,
        conversationId: fromPhone,
        direction: "outgoing",
        from: phoneNumberId,
        to: fromPhone,
        messageType: response.type,
        content: response.type === "text"
          ? { text: response.text }
          : { mediaUrl: response.mediaUrl, caption: response.caption || "" },
        metaMessageId,
        status: "sent",
        messageTimestamp: new Date(),
      }).catch((e) => console.error("[basicReply] DB save failed:", e.message));

      // Push real-time WebSocket event so the auto-reply appears in the chat immediately
      const wsMessage = {
        type: "whatsapp_message",
        message: {
          from: fromPhone,
          id: metaMessageId || `auto_${Date.now()}`,
          type: response.type,
          direction: "outgoing",
          text: response.type === "text" ? response.text : undefined,
          senderName: "Agent",
          timestamp: String(Math.floor(Date.now() / 1000)),
        },
      };
      await pushWsMessageToUser(companyAdminId, wsMessage);
      console.log("[basicReply] WS push done for outgoing auto-reply");

      // Update chat last message timestamp
      await User.findOneAndUpdate(
        { _id: companyAdminId, "whatsappWaba.chats.chatNumber": fromPhone },
        { $set: { "whatsappWaba.chats.$.lastOutgoingTime": new Date() } }
      ).catch(() => {});

    } catch (e) {
      console.error("[basicReply] send failed:", e.response?.data || e.message);
    }
  }
};

/* ─────────────────────────────────────────────
   KEYWORD TRIGGER FOR FULL FLOWS
───────────────────────────────────────────── */
const checkFlowKeywordTrigger = async (companyAdminId, fromPhone, msgText) => {
  const flows = await WabaFlow.find({ companyAdmin: companyAdminId, isActive: true });

  for (const flow of flows) {
    const triggerNode = flow.nodes.find((n) => n.type === "trigger");
    if (!triggerNode) continue;
    const { triggerType, keyword, matchCriteria } = triggerNode.data || {};
    if (triggerType !== "keyword" || !keyword) continue;

    const kw = keyword.trim().toLowerCase();
    const msg = msgText.trim().toLowerCase();
    const matches = matchCriteria === "exact" ? msg === kw : msg.includes(kw);
    if (!matches) continue;

    // Start session
    await startFlowSession(flow, companyAdminId, fromPhone);
    break;
  }
};

/* ─────────────────────────────────────────────
   START A FLOW SESSION
───────────────────────────────────────────── */
const startFlowSession = async (flow, companyAdminId, phone) => {
  // Kill existing active sessions
  await WabaFlowSession.updateMany(
    { companyAdmin: companyAdminId, contactPhone: phone, status: "active" },
    { status: "timeout" }
  );

  const triggerNode = flow.nodes.find((n) => n.type === "trigger");
  const firstEdge = flow.edges.find((e) => e.source === triggerNode?.id);
  const firstNodeId = firstEdge?.target;
  if (!firstNodeId) return;

  const session = await WabaFlowSession.create({
    flow: flow._id,
    companyAdmin: companyAdminId,
    contactPhone: phone,
    currentNodeId: firstNodeId,
    status: "active",
  });

  await executeNode(session, flow, null);
};

/* ─────────────────────────────────────────────
   END SESSION + SAVE SUBMISSION
───────────────────────────────────────────── */
const endSession = async (session, flow, status) => {
  session.status = status;
  session.completedAt = new Date();
  await session.save();

  // Resolve contact/lead
  const rec = await resolveContactModel(session.contactPhone, session.companyAdmin);

  // Save submission (Option C)
  await WabaFlowSubmission.create({
    flow: flow._id,
    session: session._id,
    companyAdmin: session.companyAdmin,
    flowName: flow.name,
    contactPhone: session.contactPhone,
    contactId: rec?.recordId || null,
    contactType: rec?.type || "unknown",
    answers: session.answers,
    status,
    completedAt: new Date(),
  });
};

/* ─────────────────────────────────────────────
   TIMEOUT CRON — call from a scheduled job
───────────────────────────────────────────── */
const timeoutStaleSessions = async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleSessions = await WabaFlowSession.find({
    status: "active",
    lastActivityAt: { $lt: cutoff },
  });

  for (const session of staleSessions) {
    const flow = await WabaFlow.findById(session.flow);
    if (flow) await endSession(session, flow, "timeout");
  }
};

/* ─────────────────────────────────────────────
   NEW CONTACT TRIGGER
───────────────────────────────────────────── */
const triggerNewContactFlows = async (companyAdminId, phone) => {
  const flows = await WabaFlow.find({ companyAdmin: companyAdminId, isActive: true });
  for (const flow of flows) {
    const triggerNode = flow.nodes.find((n) => n.type === "trigger");
    if (triggerNode?.data?.triggerType === "newContact") {
      await startFlowSession(flow, companyAdminId, phone);
      break;
    }
  }
};

module.exports = {
  handleIncomingMessage,
  executeNode,
  startFlowSession,
  timeoutStaleSessions,
  triggerNewContactFlows,
};
