// utils/phoneUtils.js
const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * normalizePhone({ phonenumber, countryCode, apiType = 'mobile', defaultCountry })
 * Returns { countryCode, number } both as digit-only strings (no '+').
 */
function normalizePhone({ phonenumber = '', countryCode = '', apiType = 'mobile', defaultCountry = undefined }) {
  const rawInput = String(phonenumber || '').trim();
  // remove spaces, allow a leading +
  const raw = rawInput.replace(/\s+/g, '');
  let cc = String(countryCode || '').replace(/\D/g, '');
  let number = raw.replace(/\D/g, '');

  // Try libphonenumber-js first (works if input has leading + or is parseable)
  try {
    // Try parse with whatever was provided
    let parsed = parsePhoneNumberFromString(raw);
    if ((!parsed || !parsed.isValid()) && defaultCountry) {
      parsed = parsePhoneNumberFromString(raw, defaultCountry);
    }
    if ((!parsed || !parsed.isValid()) && !raw.startsWith('+')) {
      // try with +prefix (useful when web sends "9170..." without +)
      parsed = parsePhoneNumberFromString('+' + raw);
    }

    if (parsed && parsed.isValid()) {
      return {
        countryCode: String(parsed.countryCallingCode || '').replace(/\D/g, ''),
        number: String(parsed.nationalNumber || '').replace(/\D/g, '')
      };
    }
  } catch (err) {
    // fall back to heuristics below
  }

  // Fallback heuristics:
  // If string has >10 digits assume last 10 digits are national number (common for many countries like IN)
  if (number.length > 10) {
    const national = number.slice(-10);
    const calling = number.slice(0, number.length - 10);
    return { countryCode: String(calling), number: String(national) };
  }

  // If we have separate countryCode provided, use it (mobile path)
  if (cc) {
    return { countryCode: cc, number };
  }

  // Last fallback: return whatever digits we have
  return { countryCode: '', number };
}

module.exports = { normalizePhone };
