import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import WsConnection from "./models/wsConnection.mjs";
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

export const handler = async (event) => {
    console.log("saveConnection-waba:", event);

    await connectDB();

    if (event.action === "connect") {
        const decoded = decodeToken(event.token);
        if (!decoded?._id) return;
        console.log("token", decoded);
        console.log("userid", decoded._id);

        const result = await WsConnection.updateOne(
            { connectionId: event.connectionId },
            { userId: decoded._id },
            { upsert: true }
        );

        console.log(result);

    }

    if (event.action === "disconnect") {
        console.log("event.connectionId", event.connectionId);

        await WsConnection.deleteOne({ connectionId: event.connectionId });
        // every 5 minutes
        // await WsConnection.deleteMany({ lastSeen: { $lt: Date.now() - 2 * 60 * 1000 } })
    }
};