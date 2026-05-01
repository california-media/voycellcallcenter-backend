// ISO alpha-2 country code lookup by country name (DIDLogic uses full names)
const COUNTRY_NAME_TO_CODE = {
  "Argentina": "AR", "Australia": "AU", "Austria": "AT", "Belgium": "BE",
  "Benin": "BJ", "Brazil": "BR", "Bulgaria": "BG", "Canada": "CA",
  "Chile": "CL", "China": "CN", "Colombia": "CO", "Costa Rica": "CR",
  "Croatia": "HR", "Czech Republic": "CZ", "Denmark": "DK", "Ecuador": "EC",
  "El Salvador": "SV", "Estonia": "EE", "Finland": "FI", "France": "FR",
  "Germany": "DE", "Hong Kong": "HK", "Iceland": "IS", "India": "IN",
  "Indonesia": "ID", "Ireland": "IE", "Israel": "IL", "Italy": "IT",
  "Japan": "JP", "Kenya": "KE", "Kuwait": "KW", "Luxembourg": "LU",
  "Malaysia": "MY", "Mexico": "MX", "Morocco": "MA", "Netherlands": "NL",
  "New Zealand": "NZ", "Nigeria": "NG", "Norway": "NO", "Panama": "PA",
  "Peru": "PE", "Philippines": "PH", "Poland": "PL", "Portugal": "PT",
  "Romania": "RO", "Saudi Arabia": "SA", "Singapore": "SG", "Slovakia": "SK",
  "South Africa": "ZA", "South Korea": "KR", "Spain": "ES", "Sweden": "SE",
  "Switzerland": "CH", "Taiwan": "TW", "Thailand": "TH", "Turkey": "TR",
  "Ukraine": "UA", "United Arab Emirates": "AE", "United Kingdom": "GB",
  "United States": "US", "Uruguay": "UY", "Vietnam": "VN",
};

// KYC document requirements by ISO country code
// source: standard telecom regulatory requirements
const KYC_REQUIREMENTS = {
  // No special documents required
  "LU": { required: false, level: "none", documents: [], notes: "" },
  "US": { required: false, level: "none", documents: [], notes: "" },
  "CA": { required: false, level: "none", documents: [], notes: "" },
  "AU": { required: false, level: "basic", documents: ["id_document"], notes: "Government-issued photo ID required." },
  "FI": { required: false, level: "none", documents: [], notes: "" },
  "DK": { required: false, level: "none", documents: [], notes: "" },
  "NO": { required: false, level: "none", documents: [], notes: "" },
  "SE": { required: false, level: "none", documents: [], notes: "" },
  "IS": { required: false, level: "none", documents: [], notes: "" },
  "EE": { required: false, level: "none", documents: [], notes: "" },
  "IE": { required: false, level: "none", documents: [], notes: "" },

  // Basic ID required
  "NL": { required: true, level: "basic", documents: ["id_document", "address_proof"], notes: "EU regulation requires proof of identity and address." },
  "BE": { required: true, level: "basic", documents: ["id_document"], notes: "Government-issued ID required." },
  "AT": { required: true, level: "basic", documents: ["id_document"], notes: "Government-issued ID required." },
  "CH": { required: true, level: "basic", documents: ["id_document"], notes: "Government-issued ID required." },
  "CZ": { required: true, level: "basic", documents: ["id_document"], notes: "Government-issued ID required." },
  "SK": { required: true, level: "basic", documents: ["id_document"], notes: "Government-issued ID required." },
  "HR": { required: true, level: "basic", documents: ["id_document"], notes: "Government-issued ID required." },
  "BG": { required: true, level: "basic", documents: ["id_document"], notes: "Government-issued ID required." },
  "RO": { required: true, level: "basic", documents: ["id_document"], notes: "Government-issued ID required." },

  // Full KYC — ID + address proof
  "DE": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "Germany requires proof of local address or business registration." },
  "FR": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "France requires identity and address proof per ARCEP regulations." },
  "ES": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "Spain requires DNI/NIE or passport plus local address." },
  "IT": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "Italy requires Codice Fiscale or passport plus address." },
  "PT": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "Portugal requires ID and proof of address." },
  "PL": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "Poland requires valid ID and address documentation." },
  "GB": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "UK Ofcom requires identity and address verification." },
  "IL": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "Israel requires government ID and local address." },
  "SG": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "Singapore IMDA requires identity and local address proof." },
  "HK": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "Hong Kong requires HKID or passport and local address." },
  "JP": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "Japan requires government ID and local address." },
  "TW": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "Taiwan requires ID and local address." },
  "NZ": { required: true, level: "full", documents: ["id_document", "address_proof"], notes: "New Zealand requires identity and address proof." },

  // Strict — additional business docs
  "IN": { required: true, level: "strict", documents: ["id_document", "address_proof", "business_registration"], notes: "India DOT requires proof of identity, local address, and purpose of use." },
  "SA": { required: true, level: "strict", documents: ["id_document", "address_proof", "business_registration"], notes: "Saudi Arabia requires national ID/Iqama and local business registration." },
  "AE": { required: true, level: "strict", documents: ["id_document", "address_proof", "business_registration"], notes: "UAE requires Emirates ID or passport and UAE trade license." },
  "KW": { required: true, level: "strict", documents: ["id_document", "address_proof", "business_registration"], notes: "Kuwait requires valid ID and local presence documentation." },
  "ZA": { required: true, level: "strict", documents: ["id_document", "address_proof"], notes: "South Africa RICA requires identity and address verification." },
  "NG": { required: true, level: "strict", documents: ["id_document", "address_proof"], notes: "Nigeria NCC requires government ID and proof of address." },
  "BR": { required: true, level: "strict", documents: ["id_document", "address_proof", "business_registration"], notes: "Brazil Anatel requires CPF/CNPJ and address proof." },
  "MX": { required: true, level: "strict", documents: ["id_document", "address_proof", "business_registration"], notes: "Mexico requires IFE/passport and RFC number." },

  // Default fallback
  "default": { required: false, level: "none", documents: [], notes: "" },
};

const DOCUMENT_LABELS = {
  "id_document": "Government-issued Photo ID (Passport, National ID, or Driver's License)",
  "address_proof": "Proof of Address (Utility bill, bank statement, or lease — dated within 90 days)",
  "business_registration": "Business Registration Certificate or Trade License",
};

function getCountryCode(countryName) {
  return COUNTRY_NAME_TO_CODE[countryName] || null;
}

function getFlagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  return countryCode.toUpperCase().split("").map((c) =>
    String.fromCodePoint(0x1f1e0 + c.charCodeAt(0) - 65)
  ).join("");
}

function getKYCRequirements(countryName) {
  const code = getCountryCode(countryName);
  return KYC_REQUIREMENTS[code] || KYC_REQUIREMENTS["default"];
}

function deriveNumberType(area) {
  if (!area) return "local";
  const a = area.toLowerCase();
  if (a.includes("mobile")) return "mobile";
  if (a.includes("toll") || a.includes("free")) return "tollfree";
  if (a.includes("voip") || a.includes("national")) return "voip";
  return "local";
}

module.exports = {
  COUNTRY_NAME_TO_CODE,
  KYC_REQUIREMENTS,
  DOCUMENT_LABELS,
  getCountryCode,
  getFlagEmoji,
  getKYCRequirements,
  deriveNumberType,
};
