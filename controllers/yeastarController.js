// controllers/yeastarController.js
const axios = require('axios');

const BASE = process.env.YEASTAR_BASE_URL; // e.g. https://cmedia.ras.yeastar.com/api/v2.0.0
const USER = process.env.YEASTAR_USERNAME;
const PASS = process.env.YEASTAR_PASSWORD;
const USER_AGENT = process.env.YEASTAR_USER_AGENT || 'YourApp/1.0';

let tokenCache = { token: null, refreshToken: null, expiresAt: 0 };

const axiosInstance = axios.create({
  baseURL: BASE,
  headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' },
  timeout: 15000,
});

async function login() {
  const res = await axiosInstance.post('/login', { username: USER, password: PASS });
  tokenCache.token = res.data.token || res.data.data?.token;
  tokenCache.refreshToken = res.data.refreshtoken || res.data.data?.refreshtoken;
  tokenCache.expiresAt = Date.now() + (res.data.expires_in || 29 * 60) * 1000;
  return tokenCache.token;
}

async function ensureToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 30_000) return tokenCache.token;
  return await login();
}

/**
 * Create extension with forced extension number (tries single number)
 * returns { success: true, data } or { success: false, error }
 */
async function createExtensionWithNumber(extensionNumber, payload = {}) {
  try {
    const token = await ensureToken();
    // adjust query param name (access_token or token) depending on your PBX
    const url = `/extension/create?access_token=${token}`;
    const body = { extension: String(extensionNumber), ...payload };
    const res = await axiosInstance.post(url, body);

    // Normalize success check depending on your PBX response
    if (res.data && (res.data.status === 'Success' || res.data.code === 0)) {
      return { success: true, data: res.data };
    }

    return { success: false, error: res.data || 'unknown error' };
  } catch (err) {
    // If Yeastar returns 4xx with message that extension exists, bubble that message
    const errMsg = err.response?.data || err.message;
    return { success: false, error: errMsg };
  }
}

/**
 * Try to create an extension by scanning numbers sequentially.
 * startFrom: integer (e.g. 1001), maxAttempts: how many numbers to try
 * returns { extensionNumber, secret, result } or throws on fatal error / none found
 */
async function createYeastarExtensionSequential({ startFrom = 1001, maxAttempts = 200, name = '' } = {}) {
  // generate secret once for whichever number succeeds
  const secret = (Math.random().toString(36).slice(2, 10) + Date.now().toString(36)).slice(0, 16);

  for (let i = 0; i < maxAttempts; i++) {
    const candidate = startFrom + i;
    const payload = {
      name: name || `User ${candidate}`,
      secret,
      voicemail: true,
      outbound_call_enable: true,
    };

    const attempt = await createExtensionWithNumber(candidate, payload);

    if (attempt.success) {
      return {
        extensionNumber: String(candidate),
        secret,
        result: attempt.data,
      };
    }

    // If error indicates "exists", continue to next candidate.
    // For safety, inspect attempt.error for keywords — common responses show "Extension already exists" or similar.
    const errText = typeof attempt.error === 'string' ? attempt.error.toLowerCase() : JSON.stringify(attempt.error).toLowerCase();
    if (errText.includes('already exists') || errText.includes('exists') || errText.includes('duplicate')) {
      // continue loop and try next candidate
      continue;
    }

    // For other transient errors (rate limit, server error), you may want to retry few times:
    if (attempt.error && (errText.includes('limit') || errText.includes('timeout') || errText.includes('server'))) {
      // wait a short time and retry the same number once
      await new Promise((r) => setTimeout(r, 500));
      const retry = await createExtensionWithNumber(candidate, payload);
      if (retry.success) {
        return {
          extensionNumber: String(candidate),
          secret,
          result: retry.data,
        };
      }
      // if still fails with 'exists' continue, otherwise continue scanning
      const retryErr = typeof retry.error === 'string' ? retry.error.toLowerCase() : JSON.stringify(retry.error).toLowerCase();
      if (retryErr.includes('already exists')) continue;
    }

    // If the error is unknown and not 'exists', continue scanning — do not throw immediately.
    continue;
  }

  throw new Error(`No available extension found in range ${startFrom}..${startFrom + maxAttempts - 1}`);
}

module.exports = {
  createExtensionWithNumber,
  createYeastarExtensionSequential,
  ensureToken,
};
