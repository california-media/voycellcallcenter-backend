const axios = require("axios");
const DIDLogicSettings = require("../models/DIDLogicSettings");

const BASE = "https://app.didlogic.com/api";

async function getSettings() {
  let settings = await DIDLogicSettings.findOne({ key: "global" }).lean();
  if (!settings) {
    settings = await DIDLogicSettings.findOneAndUpdate(
      { key: "global" },
      { $setOnInsert: { key: "global", apiToken: process.env.DIDLOGIC_API_TOKEN || "" } },
      { upsert: true, new: true }
    );
  }
  // Fall back to env var if DB has no token saved yet
  if (!settings.apiToken && process.env.DIDLOGIC_API_TOKEN) {
    settings.apiToken = process.env.DIDLOGIC_API_TOKEN;
  }
  return settings;
}

function makeClient(token) {
  return axios.create({
    baseURL: BASE,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 15000,
  });
}

// ── Account balance (v1) ──────────────────────────────────────────────────────
async function getBalance() {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get("/v1/balance");
  return res.data; // { balance: 29.09 }
}

// ── All purchased DID numbers on the master DIDLogic account (v1) ─────────────
// Returns: { purchases: [{number, channels, country, area, codec, activation, monthly_fee, per_minute, check_state, free_minutes}], pagination }
async function getMasterPurchases({ page = 1, perPage = 100 } = {}) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get("/v1/purchases", {
    params: { page, per_page: perPage },
  });
  return res.data;
}

// ── Call records (v1) ─────────────────────────────────────────────────────────
// Returns: { calls: [{timestamp, type, amount, duration, from, to, destination_name, sip_account}], pagination }
async function getCallRecords({ from, to, page = 1, perPage = 100 } = {}) {
  const { apiToken } = await getSettings();
  const params = { page, per_page: perPage };
  if (from) params.from = from;
  if (to) params.to = to;
  const res = await makeClient(apiToken).get("/v1/calls", { params });
  return res.data;
}

// ── v2 DID numbers (more detail, includes id for each number) ─────────────────
// Returns: { dids: [{id, number, country, area, channels, activation, monthly_fee, per_minute, services, status, destination_count}] }
async function getMasterDIDs() {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get("/v2/numbers");
  return res.data;
}

// ── v2 Numbers & Inventory ────────────────────────────────────────────────────

// GET /v2/numbers/countries
// Returns: { countries: [{ id, name, short_name, has_provinces_or_states }] }
async function getAllCountries() {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get("/v2/numbers/countries");
  return res.data;
}

// GET /v2/numbers/countries/:country_id/regions
// For countries with has_provinces_or_states=true (US, Canada, etc.)
// Returns list of states/provinces
async function getRegionsForCountry(countryId) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get(`/v2/numbers/countries/${countryId}/regions`);
  return res.data;
}

// GET /v2/numbers/countries/:country_id/cities
// For countries WITHOUT provinces/states
// Returns list of cities with DID counts and area codes
async function getCitiesForCountry(countryId, params = {}) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get(`/v2/numbers/countries/${countryId}/cities`, { params });
  return res.data;
}

// GET /v2/numbers/countries/:country_id/locations?prefix=212
// Search locations matching a number prefix
async function getLocationsForCountry(countryId, prefix) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get(`/v2/numbers/countries/${countryId}/locations`, {
    params: prefix ? { prefix } : {},
  });
  return res.data;
}

// GET /v2/numbers/countries/:country_id/cities/:city_id/dids
// Paginated list of available DID numbers in a city
// params: { page, per_page }
async function getNumbersByCity(countryId, cityId, params = {}) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get(
    `/v2/numbers/countries/${countryId}/cities/${cityId}/dids`,
    { params }
  );
  return res.data;
}

// GET /v2/numbers/search
// Advanced search: { country_id, city_id, region_id, prefix, features, page, per_page }
async function searchNumbers(params = {}) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get("/v2/numbers/search", { params });
  return res.data;
}

// POST /v2/numbers/purchase  — multipart/form-data
// Per API docs (https://docs.didlogic.com/docs/api/purchase-numbers):
//   id_in[]       — array of DID IDs to purchase
//   did_numbers[] — array of DID phone numbers
//   identities[]  — array of JSON objects  { id, did_ids } or { id, did_numbers }
async function purchaseNumbers({ id_in = [], did_numbers = [], identities = [] }) {
  const { apiToken } = await getSettings();
  const FormData = require("form-data");
  const form = new FormData();

  // Append each DID ID as a separate id_in[] field
  id_in.forEach((id) => form.append("id_in[]", String(id)));

  // Append each phone number as a separate did_numbers[] field
  did_numbers.forEach((n) => form.append("did_numbers[]", String(n)));

  // Append each identity object serialised as JSON in its own identities[] field
  identities.forEach((identity) =>
    form.append("identities[]", JSON.stringify(identity))
  );

  // ── Log exactly what will be sent BEFORE the API call ──────────────────────
  console.log(`\n[DIDProvider] ⬆️  About to call purchase API`);
  console.log(`[DIDProvider]    URL        : POST ${BASE}/v2/numbers/purchase`);
  console.log(`[DIDProvider]    id_in[]    :`, id_in);
  console.log(`[DIDProvider]    did_numbers[]:`, did_numbers);
  console.log(`[DIDProvider]    identities[]:`, identities);
  console.log(`[DIDProvider]    Token      : ${apiToken ? `${apiToken.slice(0, 6)}...${apiToken.slice(-4)}` : "NOT SET ⚠️"}`);
  // ───────────────────────────────────────────────────────────────────────────

  const res = await axios.post(`${BASE}/v2/numbers/purchas`, form, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...form.getHeaders(),   // sets the correct multipart/form-data Content-Type + boundary
    },
    timeout: 15000,
  });
  return res.data;
}

// ── KYC Documents (v2) ───────────────────────────────────────────────────────

// ── KYC Documents (v2) ───────────────────────────────────────────────────────

// GET /api/v2/documents
// Filters: approvement_status, identity_id, from_date, to_date, page, per_page
async function listDocuments(params = {}) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get("/v2/documents", { params });
  return res.data;
}

// POST /api/v2/documents  — multipart/form-data with bracket-notation fields
// DIDLogic expects:
//   document[name]                  required
//   document[doc_type]              required  (personal_id | address_proof)
//   document[identity_id]           required  (integer)
//   document[files][frontside]      required  (binary)
//   document[files][backside]       optional  (binary, personal_id only)
//   document[country]               optional  (country code e.g. "UK")
async function uploadDocument({
  frontsideBuffer, frontsideName, frontsideMime,
  backsideBuffer, backsideName, backsideMime,
  docType, name, identityId, country,
}) {
  const { apiToken } = await getSettings();
  const FormData = require("form-data");
  const form = new FormData();

  // Required text fields
  form.append("document[name]", name || frontsideName || "Document");
  form.append("document[doc_type]", docType);
  form.append("document[identity_id]", String(identityId));

  // Required frontside file
  form.append("document[files][frontside]", frontsideBuffer, {
    filename: frontsideName,
    contentType: frontsideMime,
  });

  // Optional backside file (personal_id only)
  if (backsideBuffer) {
    form.append("document[files][backside]", backsideBuffer, {
      filename: backsideName,
      contentType: backsideMime,
    });
  }

  // Optional country code
  if (country) form.append("document[country]", country);

  const res = await axios.post(`${BASE}/v2/documents`, form, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...form.getHeaders(),
    },
    timeout: 60000,
  });
  return res.data;
}

// GET /api/v2/documents/:id
async function getDocument(id) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get(`/v2/documents/${id}`);
  return res.data;
}

// PUT /api/v2/documents/:id
// Supports: document[name], document[identity_id]
async function updateDocument(id, payload) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).put(`/v2/documents/${id}`, payload);
  return res.data;
}

// DELETE /api/v2/documents/:id
async function deleteDocument(id) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).delete(`/v2/documents/${id}`);
  return res.data;
}

// GET /api/v2/documents/countries
async function listDocumentCountries(params = {}) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get("/v2/documents/countries", { params });
  return res.data;
}

// ── Identities (v2) ──────────────────────────────────────────────────────────
// GET /api/v2/identities
// Returns: { identities: [{ id, name, persistence_status, is_default, documents_count, ... }] }
async function listIdentities(params = {}) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).get("/v2/identities", { params });
  return res.data;
}

// POST /api/v2/identities
// DIDLogic uses Rails conventions — resource wrapped: { identity: { name } }
async function createIdentity(name) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).post("/v2/identities", { identity: { name } });
  return res.data;
}

// DELETE /api/v2/identities/:id — archives (soft-deletes) the identity
async function archiveIdentity(id) {
  const { apiToken } = await getSettings();
  const res = await makeClient(apiToken).delete(`/v2/identities/${id}`);
  return res.data;
}

// GET /api/v2/documents/:id/files/:role  — download binary file
// role: "frontside" | "backside"
async function downloadDocumentFile(id, role) {
  const { apiToken } = await getSettings();
  const res = await axios.get(`${BASE}/v2/documents/${id}/files/${role}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
    },
    responseType: "arraybuffer",
    timeout: 30000,
  });
  return { data: res.data, headers: res.headers };
}

module.exports = {
  createIdentity,
  archiveIdentity,
  getSettings,
  getBalance,
  getMasterPurchases,
  getMasterDIDs,
  getCallRecords,
  getAllCountries,
  // Numbers & Inventory
  getRegionsForCountry,
  getCitiesForCountry,
  getLocationsForCountry,
  getNumbersByCity,
  searchNumbers,
  purchaseNumbers,
  // KYC Documents
  listDocuments,
  uploadDocument,
  getDocument,
  updateDocument,
  deleteDocument,
  listDocumentCountries,
  listIdentities,
  downloadDocumentFile,
};
