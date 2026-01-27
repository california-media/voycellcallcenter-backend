import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import incomingcallConnection from "./models/incomingcallConnection.mjs";
import dotenv from "dotenv";
dotenv.config();

let isConnected = false;

const connectDB = async () => {
    // if (isConnected) return;
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(process.env.MONGO_URL, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 10000,
    });
    isConnected = true;
};

const decodeToken = (token) => {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return null;
    }
};

export const handler = async (event, context) => {
    console.log("====================================");
    console.log("[HANDLER] incomming call invoked");
    console.log("[HANDLER] Raw event:", JSON.stringify(event, null, 2));
    console.log("[HANDLER] Timestamp:", new Date().toISOString());
    context.callbackWaitsForEmptyEventLoop = false;
    console.log("[HANDLER] Action:", event.action);

    try {
        await connectDB();
    } catch (err) {
        console.error("[HANDLER] Failed to connect to DB:", err);
        return { statusCode: 500, body: "Database connection failed" };
    }

    if (event.action === "connect") {
        console.log("[CONNECT] New connection attempt");
        console.log("[CONNECT] connectionId:", event.connectionId);

        const decoded = decodeToken(event.token);

        if (!decoded?._id) {
            console.warn("[CONNECT] Invalid or missing user ID, aborting");
            return { statusCode: 401, body: "Unauthorized" };
        }

        console.log("[CONNECT] User authenticated");
        console.log("[CONNECT] userId:", decoded._id);

        try {
            const result = await incomingcallConnection.updateOne(
                { connectionId: event.connectionId },
                {
                    userId: decoded._id,
                    lastSeen: Date.now(),
                },
                { upsert: true }
            );
            console.log("[CONNECT] DB update result:", result);
            return { statusCode: 200, body: "Connected" };
        } catch (err) {
            console.error("[CONNECT] Failed to save connection", err);
            return { statusCode: 500, body: "Failed to save connection" };
        }
    }

    if (event.action === "disconnect") {
        console.log("[DISCONNECT] Disconnect event received");
        console.log("[DISCONNECT] connectionId:", event.connectionId);

        try {
            const result = await incomingcallConnection.deleteOne({
                connectionId: event.connectionId,
            });

            console.log(
                "[DISCONNECT] Cleanup complete",
                "deletedCount:",
                result.deletedCount
            );
            return { statusCode: 200, body: "Disconnected" };
        } catch (err) {
            console.error("[DISCONNECT] Cleanup failed", err);
            return { statusCode: 500, body: "Cleanup failed" };
        }
    }

    console.log("[HANDLER] Execution finished");
    console.log("====================================");
    return { statusCode: 200, body: "OK" };
};

// export const handler = async (event) => {
//     console.log("event form test", event);
// }