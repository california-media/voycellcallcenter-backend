const mongoose = require("mongoose");
const WsConnection = require("../models/wsConnection");
const jwt = require("jsonwebtoken");

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  await mongoose.connect(process.env.MONGO_URI);
  isConnected = true;
}

// exports.handler = async (event) => {
//   try {
//     await connectDB();

//     const connectionId = event.requestContext.connectionId;
//     const token = event.queryStringParameters?.token;

//     if (!token) return { statusCode: 401 };

//     const decoded = jwt.verify(token, process.env.JWT_SECRET);

//     await WsConnection.create({
//       userId: decoded._id.toString(),
//       connectionId,
//     });

//     console.log("✅ WS connection saved:", connectionId);

//     return { statusCode: 200 };
//   } catch (err) {
//     console.error("❌ $connect error:", err);
//     return { statusCode: 500 };
//   }
// };


exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = true;

  try {
    console.log("🔌 Incoming $connect", event);

    await connectDB();

    const connectionId = event.requestContext.connectionId;
    const token = event.queryStringParameters?.token;
    console.log("Token:", token);

    if (!token) return { statusCode: 401, body: "No token" };

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded JWT:", decoded);

    const conn = await WsConnection.create({
      userId: decoded._id.toString(),
      connectionId,
    });

    console.log("✅ WS connection saved:", conn);

    return { statusCode: 200, body: "Connected" };
  } catch (err) {
    console.error("❌ $connect error:", err);
    return { statusCode: 500, body: err.message };
  }
};
