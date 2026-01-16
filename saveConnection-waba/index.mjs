import mongoose from 'mongoose';
import WsConnection from './models/wsConnection.mjs';
import User from "./models/userModel.mjs"; // adjust path if needed
import WhatsAppMessage from "./models/whatsappMessage.mjs"; // we’ll add this
import jwt from "jsonwebtoken";
import dotenv from 'dotenv';
dotenv.config();

let isConnected = false;

const decodeToken = (token) => {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        console.error("Invalid token");
        return null;
    }
};


const connectDB = async () => {
    if (mongoose.connection.readyState === 1) {
        console.log("MongoDB already connected");
        return;
    }


    console.log("🔌 Connecting to MongoDB...");
    const MONGO_URL = "mongodb+srv://voycellcallcenterdb:IskIIdZUSk4QsyMA@cluster0.lrzweyr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
    await mongoose.connect(MONGO_URL, {
        maxPoolSize: 10, // Lower pool size for Lambda (not 200!)
        minPoolSize: 1, // Keep it minimal
        serverSelectionTimeoutMS: 10000, // Increase timeout
        socketTimeoutMS: 45000, // Socket timeout
        connectTimeoutMS: 10000, // Connection timeout
        retryWrites: true,
        retryReads: true,
        maxIdleTimeMS: 10000, // Close idle connections faster
        // Disable buffering - fail fast instead of queuing
        bufferCommands: false,
    });
    isConnected = true;
    console.log("MongoDB Connected");
};
console.log("called waba-saveConnection")
export const handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = true;
    console.log("saveConnectionLambda triggered with event:", JSON.stringify(event));

    const connectionId = event.connectionId;
    const routeKey = event.routeKey;
    const token = event.token;

    if (routeKey === "$connect") {
        if (!connectionId) {
            console.warn("no connectionId in event");
            return { statusCode: 400, body: "No connectionId" };
        }
        try {
            await connectDB();
            console.log(`saving connectionId: ${connectionId} to MongoDB...`);

            // const WsConnection = wsConnection();
            // await WsConnection.create({ connectionId });
            // const result = await WsConnection.create({ connectionId });
            const decoded = decodeToken(token);

            if (!decoded || !decoded._id) {
                return { statusCode: 401, body: "Unauthorized" };
            }

            const userId = decoded._id;

            const result = await WsConnection.create({
                connectionId,
                userId
            });

            console.log(`successfully saved connectionId: ${connectionId}`);
            console.log("DB result:", result);

            return { statusCode: 200, body: "Saved" };
        } catch (err) {
            if (err.code === 11000) {
                console.warn(`connectionId ${connectionId} already exists`);
                return { statusCode: 200, body: "Already exists" };
            }
            console.error("failed to save connectionId:", err);
            return { statusCode: 500, body: "DB Error" };
        }
    }
    if (routeKey === "$disconnect") {
        try {
            await connectDB();
            console.log(`deleting connectionId: ${connectionId} from MongoDB...`);
            const result = await WsConnection.deleteOne({ connectionId });
            if (result.deletedCount === 0) {
                console.warn(`connectionId ${connectionId} not found for deletion`);
                return { statusCode: 404, body: "Not Found" };
            }
            console.log(`successfully deleted connectionId: ${connectionId}`);
            return { statusCode: 200, body: "Deleted" };
        } catch (err) {
            console.error("failed to delete connectionId:", err);
            return { statusCode: 500, body: "DB Error" };
        }
    }

    if (event.action === "getAllConnections") {
        try {
            await connectDB();
            console.log("Fetching all connection IDs...");
            const connections = await WsConnection.find({}, "connectionId userId"); // Only fetch connectionId field
            const connectionIds = connections.map(c => c.connectionId);
            console.log(`Found ${connectionIds.length} connections.`);
            return { connectionIds }; // Return directly
        } catch (err) {
            console.error("Failed to get connections:", err);
            throw err; // Let the caller handle the error
        }
    }


    if (event.action === "processWhatsappWebhook") {
        try {
            await connectDB();

            const webhookBody = event.payload;

            const wabaId = webhookBody?.entry?.[0]?.id;
            if (!wabaId) {
                console.warn("No wabaId found");
                return { connectionIds: [] };
            }

            console.log("Processing webhook for wabaId:", wabaId);

            // 1️⃣ Find user by wabaId
            const user = await User.findOne({
                "whatsappWaba.wabaId": wabaId
            }).select("_id");

            console.log("user", user);

            if (!user) {
                console.warn("No user found for wabaId");
                return { connectionIds: [] };
            }

            const userId = user._id;

            // 2️⃣ Extract & Save messages FIRST
            const messagesToSend = [];

            for (const entry of webhookBody.entry || []) {
                for (const change of entry.changes || []) {
                    const value = change.value;
                    if (!value?.messages) continue;

                    for (const msg of value.messages) {
                        await WhatsAppMessage.create({
                            userId,
                            wabaId,
                            from: msg.from,
                            message: msg,
                            timestamp: msg.timestamp
                        });

                        messagesToSend.push({
                            type: "whatsapp_message",
                            data: {
                                from: msg.from,
                                text: msg.text?.body || "Media/Other Message",
                                timestamp: msg.timestamp,
                                full_message: msg
                            }
                        });
                    }
                }
            }

            // 3️⃣ Get WebSocket connections
            const connections = await WsConnection.find(
                { userId },
                "connectionId"
            );

            const connectionIds = connections.map(c => c.connectionId);

            console.log(`Found ${connectionIds.length} connections`);

            // 4️⃣ Trigger waba-connect ASYNC
            await lambda.invoke({
                FunctionName: "waba-connect",
                InvocationType: "Event", // ✅ ASYNC
                Payload: JSON.stringify({
                    action: "broadcast",
                    connectionIds,
                    messages: messagesToSend
                })
            }).promise();

            return { statusCode: 200 };

        } catch (err) {
            console.error("processWhatsappWebhook failed:", err);
            throw err;
        }
    }

};
