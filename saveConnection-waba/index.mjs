import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import WsConnection from "./models/wsConnection.mjs";
import dotenv from "dotenv";

dotenv.config();


const connectDB = async () => {
    try {
        if (mongoose.connection.readyState === 1) {
            return;
        }
        const start = Date.now();

        await mongoose.connect(process.env.MONGO_URL, {
            maxPoolSize: 5,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
        });
    } catch (err) {
        console.error("[DB] Connection failed", err);
        throw err;
    }
};

const decodeToken = (token) => {
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return decoded;
    } catch (err) {
        console.error("[AUTH] token verification failed", err.message);
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
            const result = await WsConnection.updateOne(
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
            const result = await WsConnection.deleteOne({
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
