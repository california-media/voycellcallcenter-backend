const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");

// ─── List of SSM parameters to load ──────────────────────────────────────────
// To add more variables later, just append entries to this array:
//   { name: "/voycell/production/YOUR_PARAM", envKey: "YOUR_ENV_KEY" }
// ─────────────────────────────────────────────────────────────────────────────
const SSM_PARAMS = [
  {
    name: "/voycell/production/META_SYSTEM_USER_TOKEN",
    envKey: "META_SYSTEM_USER_TOKEN",
  },
];

const client = new SSMClient({ region: "eu-north-1" });

async function _load() {
  console.log("[SSM] Loading parameters from AWS SSM Parameter Store...");

  for (const param of SSM_PARAMS) {
    try {
      const response = await client.send(
        new GetParameterCommand({ Name: param.name, WithDecryption: true })
      );
      const value = response.Parameter?.Value;
      if (value) {
        process.env[param.envKey] = value;
        console.log(`[SSM] ✅ ${param.name} → process.env.${param.envKey}`);
      } else {
        console.warn(`[SSM] ⚠️  ${param.name} returned an empty value`);
      }
    } catch (err) {
      console.error(`[SSM] ❌ Failed to load ${param.name}:`, err.message);
      throw err;
    }
  }

  console.log("[SSM] ✅ All SSM parameters loaded");
}

// Start fetching immediately on module load (cold start).
// The handler awaits this promise — by the time the first request
// arrives, the params are usually already resolved.
const loadSSMPromise = _load();

module.exports = { loadSSMPromise };
