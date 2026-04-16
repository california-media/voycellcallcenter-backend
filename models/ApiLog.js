const { Schema, model } = require("mongoose");

const apiLogSchema = new Schema(
  {
    method: { type: String, enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], required: true },
    url: { type: String, required: true },
    baseRoute: { type: String, default: "" }, // e.g. "/call", "/superAdmin"
    query: { type: Schema.Types.Mixed, default: {} },
    body: { type: Schema.Types.Mixed, default: {} }, // sanitized — no passwords/tokens
    statusCode: { type: Number, default: null },
    responseTime: { type: Number, default: null }, // ms
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    userEmail: { type: String, default: null },
    userName: { type: String, default: null },
    userRole: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true }
);

// Auto-delete logs older than 30 days
apiLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
apiLogSchema.index({ method: 1 });
apiLogSchema.index({ userId: 1 });
apiLogSchema.index({ statusCode: 1 });
apiLogSchema.index({ baseRoute: 1 });

const ApiLog = model("ApiLog", apiLogSchema);
module.exports = ApiLog;
