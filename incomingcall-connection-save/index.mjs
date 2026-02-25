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
    context.callbackWaitsForEmptyEventLoop = false;
    try {
        await connectDB();
    } catch (err) {
        console.error("[HANDLER] Failed to connect to DB:", err);
        return { statusCode: 500, body: "Database connection failed" };
    }

    if (event.action === "connect") {
        const decoded = decodeToken(event.token);

        if (!decoded?._id) {
            console.warn("[CONNECT] Invalid or missing user ID, aborting");
            return { statusCode: 401, body: "Unauthorized" };
        }

        try {
            const result = await incomingcallConnection.updateOne(
                { connectionId: event.connectionId },
                {
                    userId: decoded._id,
                    lastSeen: Date.now(),
                },
                { upsert: true }
            );
            return { statusCode: 200, body: "Connected" };
        } catch (err) {
            console.error("[CONNECT] Failed to save connection", err);
            return { statusCode: 500, body: "Failed to save connection" };
        }
    }

    if (event.action === "disconnect") {
        try {
            const result = await incomingcallConnection.deleteOne({
                connectionId: event.connectionId,
            });
            return { statusCode: 200, body: "Disconnected" };
        } catch (err) {
            console.error("[DISCONNECT] Cleanup failed", err);
            return { statusCode: 500, body: "Cleanup failed" };
        }
    }
    return { statusCode: 200, body: "OK" };
};

// export const handler = async (event) => {
//     console.log("event form test", event);
// }