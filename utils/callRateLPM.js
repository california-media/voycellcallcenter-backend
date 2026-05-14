const CallRate       = require("../models/CallRate");
const CallRateConfig = require("../models/CallRateConfig");

/**
 * Strip every character that is not a digit.
 * +971 54 239-6200 → 971542396200
 */
function normalizeDigits(value) {
  if (!value) return "";
  return value.toString().replace(/\D/g, "");
}

/**
 * Longest Prefix Match (LPM) — telecom-standard routing.
 *
 * Algorithm:
 *   1. Normalize destination to digits only.
 *   2. Generate every leading substring (prefix) of the destination,
 *      up to 15 characters (the maximum ITU-T E.164 CC+NDC length used in tariff tables).
 *   3. Also generate each prefix with a leading "+" to handle databases
 *      that store prefixes in E.164 notation.
 *   4. Query the CallRate collection with a single $in on the prefix index.
 *   5. Discard any hit whose digit-normalized prefix is NOT a true leading
 *      prefix of the destination (guards against substring false-positives).
 *   6. Return the longest valid match.
 *
 * This satisfies all the requirements:
 *   - No digit-by-digit removal from the destination.
 *   - Only START-OF-NUMBER matches are accepted.
 *   - Multiple candidates → longest one wins.
 *   - Uses the existing `{ prefix: 1 }` index for O(log N) lookup per candidate.
 *
 * @param {string} destinationNumber  Raw destination (may contain +, spaces, dashes)
 * @returns {Promise<{country, prefix, standardRate, customerRate}|null>}
 */
async function findCallRateByLPM(destinationNumber) {
  const normalized = normalizeDigits(destinationNumber);
  if (!normalized) return null;

  // Build candidate set: every leading prefix (digits-only and E.164 form)
  const candidates = new Set();
  const maxLen = Math.min(normalized.length, 15);
  for (let len = 1; len <= maxLen; len++) {
    const pfx = normalized.substring(0, len);
    candidates.add(pfx);
    candidates.add("+" + pfx);
  }

  // Single indexed query against the CallRate collection
  const hits = await CallRate.find({ prefix: { $in: [...candidates] } }).lean();
  if (!hits.length) return null;

  // Pick the longest hit whose normalized prefix is a true leading prefix
  let best    = null;
  let bestLen = -1;

  for (const rate of hits) {
    const pfxDigits = normalizeDigits(rate.prefix);
    if (!pfxDigits) continue;

    // Validity check: destination must START WITH this prefix (not just contain it)
    if (normalized.startsWith(pfxDigits) && pfxDigits.length > bestLen) {
      bestLen = pfxDigits.length;
      best    = rate;
    }
  }

  if (!best) return null;

  // Apply global commission to get the customer-facing rate
  const config     = await CallRateConfig.findOne({ key: "global" }).lean();
  const commission = config?.commission ?? 0;
  const customerRate = Number(
    (best.standardRate * (1 + commission / 100)).toFixed(6)
  );

  return {
    country:      best.country,
    prefix:       best.prefix,
    standardRate: best.standardRate,
    customerRate,
  };
}

module.exports = { findCallRateByLPM, normalizeDigits };
