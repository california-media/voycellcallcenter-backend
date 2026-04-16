const ApiLog = require("../models/ApiLog");

// Fields to strip from body before saving (security)
const SENSITIVE_KEYS = new Set([
  "password", "confirmPassword", "newPassword", "oldPassword",
  "token", "accessToken", "refreshToken", "secret", "apiKey",
  "authorization", "credit_card", "cvv", "otp",
]);

// Routes to skip logging entirely
const SKIP_PREFIXES = [
  "/superAdmin/api-logs",   // avoid logging the log-fetch endpoint itself
  "/favicon.ico",
  "/check",
  "/billing/webhook",       // stripe raw body
];

function sanitizeBody(body) {
  if (!body || typeof body !== "object") return {};
  const result = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizeBody(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function getBaseRoute(url) {
  // Extract first path segment e.g. "/call/addFormData..." → "/call"
  const match = url.match(/^(\/[^/?]+)/);
  return match ? match[1] : "/";
}

const apiLoggerMiddleware = (req, res, next) => {
  const url = req.originalUrl || req.url;

  // Skip certain paths
  if (SKIP_PREFIXES.some((p) => url.startsWith(p))) {
    return next();
  }

  const startTime = Date.now();

  res.on("finish", () => {
    const responseTime = Date.now() - startTime;
    const sanitizedBody = sanitizeBody(req.body);

    ApiLog.create({
      method: req.method,
      url,
      baseRoute: getBaseRoute(url),
      query: req.query || {},
      body: sanitizedBody,
      statusCode: res.statusCode,
      responseTime,
      userId: req.user?._id || null,
      userEmail: req.user?.email || null,
      userName: req.user ? `${req.user.firstname || ""} ${req.user.lastname || ""}`.trim() || null : null,
      userRole: req.user?.role || null,
      ip: req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
    }).catch((err) => {
      // Never let logging break the app
      console.error("[ApiLogger] Failed to save log:", err.message);
    });
  });

  next();
};

module.exports = apiLoggerMiddleware;
