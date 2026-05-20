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
  for (const param of SSM_PARAMS) {
    try {
      const response = await client.send(
        new GetParameterCommand({ Name: param.name, WithDecryption: true })
      );
      const value = response.Parameter?.Value;
      if (value) {
        process.env[param.envKey] = value;
      }
    } catch (err) {
      throw err;
    }
  }
}

// Start fetching immediately on module load (cold start).
// The handler awaits this promise — by the time the first request
// arrives, the params are usually already resolved.
const loadSSMPromise = _load();

module.exports = { loadSSMPromise };
