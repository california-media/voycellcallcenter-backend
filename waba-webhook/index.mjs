import AWS from "aws-sdk";
import dotenv from "dotenv";
dotenv.config();

const apiGateway = new AWS.ApiGatewayManagementApi({
  endpoint: "https://o6iyrho5q6.execute-api.eu-north-1.amazonaws.com/production"
});

export const handler = async (event) => {
  try {
    // 🔥 Parse payload from InvokeCommand
    const payload =
      event.Payload
        ? JSON.parse(Buffer.from(event.Payload).toString())
        : event;

    const { whatsappEvent, userId, finalSenderName, connections } = payload;

    if (!whatsappEvent || !connections || connections.length === 0) {
      console.log("No data to process");
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

    let senderName = "";
    let senderWabaID = "";

    if (contact) {
      senderName = contact.profile?.name || "";
      senderWabaID = contact.wa_id || "";
    }

    console.log("Sender Name:", senderName);
    console.log("Sender WA ID:", senderWabaID);

    if (finalSenderName) {
      console.log("finalSenderName", finalSenderName);
      senderName = finalSenderName;
    }

    console.log("senderName after final sendername", senderName);


    // 🚀 Push each WhatsApp message to all WS connections
    for (const msg of value.messages) {
      for (const conn of connections) {
        try {
          console.log("into try block for send to frontend");

          // console.log(msg);
          const enrichedMsg = {
            ...msg,
            senderName,       // 👈 added
            senderWabaID      // 👈 optional but useful
          };

          console.log("enrichedMsg", enrichedMsg);

          await apiGateway.postToConnection({
            ConnectionId: conn.connectionId,
            Data: JSON.stringify({
              type: "whatsapp_message",
              userId,
              message: enrichedMsg
            })
          }).promise();
          console.log("send the message to frontend");

        } catch (err) {
          if (err.statusCode === 410) {
            console.log("🧹 Stale connection:", conn.connectionId);
            // optional: cleanup handled in main server
          } else {
            console.error("WS error:", err);
          }
        }
      }
    }

    return { statusCode: 200 };
  } catch (err) {
    console.error("Lambda error:", err);
    return { statusCode: 200 };
  }
};
