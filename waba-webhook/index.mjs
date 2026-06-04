import AWS from "aws-sdk";
import mongoose from "mongoose";
import dotenv from "dotenv";
import WsConnection from "./models/wsConnection.mjs";
dotenv.config();

const apiGateway = new AWS.ApiGatewayManagementApi({
  endpoint: "https://o6iyrho5q6.execute-api.eu-north-1.amazonaws.com/production"
});

let dbConnected = false;
const connectDB = async () => {
  if (dbConnected || mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGO_URL, { maxPoolSize: 3 });
  dbConnected = true;
};

const pushToConnection = async (conn, data) => {
  try {
    await apiGateway.postToConnection({
      ConnectionId: conn.connectionId,
      Data: JSON.stringify(data)
    }).promise();
    return { connectionId: conn.connectionId, ok: true };
  } catch (err) {
    if (err.statusCode === 410) {
      console.log("🧹 Stale connection:", conn.connectionId);
      return { connectionId: conn.connectionId, ok: false, stale: true };
    }
    console.error("WS push error:", conn.connectionId, err.message);
    return { connectionId: conn.connectionId, ok: false, stale: false };
  }
};

export const handler = async (event) => {
  try {
    const payload =
      event.Payload
        ? JSON.parse(Buffer.from(event.Payload).toString())
        : event;

    const { type, connections } = payload;

    if (!connections || connections.length === 0) {
      console.log("No connections to push to");
      return { statusCode: 200 };
    }

    // ── Message status updates ──────────────────────────────────────────────
    if (type === "message_status_update") {
      const { metaMessageId, status, conversationId, message } = payload;
      console.log("📬 Status update:", status, metaMessageId);

      const data = {
        type: "message_status_update",
        message: {
          metaMessageId,
          status,
          conversationId: conversationId || message?.conversationId,
        }
      };

      const results = await Promise.allSettled(
        connections.map(conn => pushToConnection(conn, data))
      );

      const staleIds = results
        .filter(r => r.status === "fulfilled" && r.value?.stale)
        .map(r => r.value.connectionId);

      if (staleIds.length > 0) {
        try {
          await connectDB();
          await WsConnection.deleteMany({ connectionId: { $in: staleIds } });
          console.log(`🗑️ Deleted ${staleIds.length} stale connections from DB`);
        } catch (dbErr) {
          console.error("Failed to delete stale connections:", dbErr.message);
        }
      }

      return { statusCode: 200 };
    }

    // ── Outgoing auto-reply push (basic replies / flow engine) ─────────────
    if (type === "outgoing_message") {
      const { message } = payload;
      console.log("📤 Outgoing message push from:", message?.from, "type:", message?.type);
      const data = { type: "whatsapp_message", message };
      const results = await Promise.allSettled(
        connections.map(conn => pushToConnection(conn, data))
      );
      const staleIds = results
        .filter(r => r.status === "fulfilled" && r.value?.stale)
        .map(r => r.value.connectionId);
      if (staleIds.length > 0) {
        try {
          await connectDB();
          await WsConnection.deleteMany({ connectionId: { $in: staleIds } });
          console.log(`🗑️ Deleted ${staleIds.length} stale connections`);
        } catch (dbErr) {
          console.error("Failed to delete stale connections:", dbErr.message);
        }
      }
      return { statusCode: 200 };
    }

    // ── Incoming messages ───────────────────────────────────────────────────
    const { whatsappEvent, userId, finalSenderName, s3dataurl } = payload;

    if (!whatsappEvent) {
      console.log("No whatsappEvent in payload");
      return { statusCode: 200 };
    }

    const entry = whatsappEvent.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value) {
      console.log("No value in webhook");
      return { statusCode: 200 };
    }

    if (!Array.isArray(value.messages) || value.messages.length === 0) {
      console.log("ℹ️ No incoming messages");
      return { statusCode: 200 };
    }

    console.log("📨 Messages:", value.messages.length);
    console.log("🔗 Connections:", connections.length);
    console.log("👤 User:", userId);

    const contact = value.contacts?.[0];
    let senderName = contact?.profile?.name || "";
    const senderWabaID = contact?.wa_id || "";

    if (finalSenderName) senderName = finalSenderName;

    const staleIds = [];

    for (const msg of value.messages) {
      const enrichedMsg = {
        ...msg,
        senderName,
        senderWabaID,
        s3dataurl
      };

      const data = {
        type: "whatsapp_message",
        userId,
        message: enrichedMsg
      };

      const results = await Promise.allSettled(
        connections.map(conn => pushToConnection(conn, data))
      );

      const newStale = results
        .filter(r => r.status === "fulfilled" && r.value?.stale)
        .map(r => r.value.connectionId);

      newStale.forEach(id => {
        if (!staleIds.includes(id)) staleIds.push(id);
      });

      const successCount = results.filter(r => r.status === "fulfilled" && r.value?.ok).length;
      console.log(`✅ Pushed msg ${msg.id} to ${successCount}/${connections.length} connections`);
    }

    if (staleIds.length > 0) {
      try {
        await connectDB();
        await WsConnection.deleteMany({ connectionId: { $in: staleIds } });
        console.log(`🗑️ Deleted ${staleIds.length} stale connections from DB`);
      } catch (dbErr) {
        console.error("Failed to delete stale connections:", dbErr.message);
      }
    }

    return { statusCode: 200 };
  } catch (err) {
    console.error("Lambda error:", err);
    return { statusCode: 200 };
  }
};
