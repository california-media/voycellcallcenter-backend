const did         = require("../services/didlogicService");
const DIDIdentity = require("../models/DIDIdentity");

// ── GET /didlogic/kyc/documents ───────────────────────────────────────────────
// List KYC documents
// Query params: approvement_status, identity_id, from_date, to_date, page, per_page
const listDocuments = async (req, res) => {
  try {
    const { approvement_status, identity_id, from_date, to_date, page = 1, per_page = 20 } = req.query;
    const params = { page, per_page };
    if (approvement_status) params.approvement_status = approvement_status;
    if (identity_id)        params.identity_id        = identity_id;
    if (from_date)          params.from_date           = from_date;
    if (to_date)            params.to_date             = to_date;

    const result = await did.listDocuments(params);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("listDocuments error:", err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      message: err.response?.data?.message || err.message,
    });
  }
};

// ── POST /didlogic/kyc/documents ─────────────────────────────────────────────
// Upload a new KYC document
// multipart/form-data fields (from frontend):
//   doc_type       required  personal_id | address_proof
//   name           required  display name
//   identity_id    required  integer
//   country        optional  country code e.g. UK
//   frontside      required  file
//   backside       optional  file (personal_id only)
const uploadDocument = async (req, res) => {
  try {
    const { doc_type, name, identity_id, country } = req.body;
    const files = req.files || {};
    const frontsideFile = files.frontside?.[0];
    const backsideFile  = files.backside?.[0];

    // Validate required fields
    if (!frontsideFile) {
      return res.status(400).json({ success: false, message: "Frontside file is required." });
    }
    if (!doc_type || !["personal_id", "address_proof"].includes(doc_type)) {
      return res.status(422).json({ success: false, message: "doc_type must be personal_id or address_proof." });
    }
    if (!name || !name.trim()) {
      return res.status(422).json({ success: false, message: "Document name is required." });
    }
    if (!identity_id) {
      return res.status(422).json({ success: false, message: "identity_id is required." });
    }

    const result = await did.uploadDocument({
      // Frontside (required)
      frontsideBuffer: frontsideFile.buffer,
      frontsideName:   frontsideFile.originalname,
      frontsideMime:   frontsideFile.mimetype,
      // Backside (optional, personal_id only)
      backsideBuffer: backsideFile ? backsideFile.buffer    : null,
      backsideName:   backsideFile ? backsideFile.originalname : null,
      backsideMime:   backsideFile ? backsideFile.mimetype   : null,
      // Text fields
      docType:    doc_type,
      name:       name.trim(),
      identityId: identity_id,
      country:    country || null,
    });

    res.json({ success: true, message: result.message || "Document uploaded.", data: result });
  } catch (err) {
    console.error("uploadDocument error:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      message: err.response?.data?.message || err.message,
      errors:  err.response?.data?.errors  || null,
    });
  }
};

// ── GET /didlogic/kyc/documents/:id ──────────────────────────────────────────
const getDocument = async (req, res) => {
  try {
    const result = await did.getDocument(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── PUT /didlogic/kyc/documents/:id ──────────────────────────────────────────
// Update document name and/or identity_id
// DIDLogic expects: { document: { name, identity_id } }
const updateDocument = async (req, res) => {
  try {
    const { name, identity_id } = req.body;
    const payload = { document: {} };
    if (name        !== undefined) payload.document.name        = name;
    if (identity_id !== undefined) payload.document.identity_id = identity_id;

    const result = await did.updateDocument(req.params.id, payload);
    res.json({ success: true, message: "Document updated.", data: result });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── DELETE /didlogic/kyc/documents/:id ───────────────────────────────────────
const deleteDocument = async (req, res) => {
  try {
    await did.deleteDocument(req.params.id);
    res.json({ success: true, message: "Document deleted." });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── GET /didlogic/kyc/documents/countries ────────────────────────────────────
const listDocumentCountries = async (req, res) => {
  try {
    const { search } = req.query;
    const result = await did.listDocumentCountries(search ? { search } : {});
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── GET /didlogic/kyc/documents/:id/files/:role ───────────────────────────────
// Proxy the binary file (frontside / backside) to the client
const downloadDocumentFile = async (req, res) => {
  try {
    const { id, role } = req.params;
    if (!["frontside", "backside"].includes(role)) {
      return res.status(400).json({ success: false, message: "role must be frontside or backside" });
    }

    const { data, headers } = await did.downloadDocumentFile(id, role);
    const contentType  = headers["content-type"]        || "application/octet-stream";
    const disposition  = headers["content-disposition"] || `attachment; filename="document-${id}-${role}"`;

    res.set("Content-Type",        contentType);
    res.set("Content-Disposition", disposition);
    res.send(Buffer.from(data));
  } catch (err) {
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── GET /didlogic/kyc/identities ─────────────────────────────────────────────
// Lists only identities created by this user (filtered via our DIDIdentity mapping)
const listIdentities = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get this user's DIDLogic identity IDs from our DB
    const ownedRecords = await DIDIdentity.find({ userId }).lean();
    const ownedIds     = new Set(ownedRecords.map((r) => r.didlogicId));

    if (ownedIds.size === 0) {
      return res.json({ success: true, data: { identities: [] } });
    }

    // Fetch from DIDLogic and filter to only the user's own
    const result = await did.listIdentities({ page: 1, per_page: 200 });
    const all    = result?.data?.identities || result?.identities || [];
    const filtered = all.filter((i) => ownedIds.has(i.id));

    // Merge archived status from our DB
    const archivedSet = new Set(
      ownedRecords.filter((r) => r.archived).map((r) => r.didlogicId)
    );
    const enriched = filtered.map((i) => ({
      ...i,
      archived: archivedSet.has(i.id),
    }));

    res.json({ success: true, data: { identities: enriched } });
  } catch (err) {
    console.error("listIdentities error:", err.message);
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

// ── POST /didlogic/kyc/identities ─────────────────────────────────────────────
// Creates a new identity in DIDLogic and records ownership in our DB
const createIdentity = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(422).json({ success: false, message: "Identity name is required." });
    }
    const userId = req.user._id;

    // Create in DIDLogic
    const result = await did.createIdentity(name.trim());
    // DIDLogic may return { identity: {...} }, { data: { identity: {...} } }, or the object directly
    const identity =
      result?.data?.identity ||
      result?.identity       ||
      (result?.id ? result : null);

    if (!identity?.id) {
      console.error("createIdentity: unexpected DIDLogic response:", JSON.stringify(result));
      return res.status(500).json({ success: false, message: "DIDLogic did not return an identity ID." });
    }

    // Record ownership so this user sees it in their list
    await DIDIdentity.findOneAndUpdate(
      { didlogicId: identity.id },
      { $setOnInsert: { didlogicId: identity.id, userId, name: identity.name || name.trim(), archived: false } },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Identity created.", data: identity });
  } catch (err) {
    const didErr = err.response?.data;
    console.error("createIdentity error:", err.response?.status, JSON.stringify(didErr) || err.message);

    // Parse Rails-style validation errors into a human-readable message
    let message = didErr?.message || didErr?.error || err.message;
    if (!message && didErr?.errors && typeof didErr.errors === "object") {
      message = Object.entries(didErr.errors)
        .map(([field, msgs]) => {
          const label = field.charAt(0).toUpperCase() + field.slice(1);
          const msg   = Array.isArray(msgs) ? msgs[0] : msgs;
          return `${label} ${msg}`;
        })
        .join(". ");
    }

    res.status(err.response?.status || 500).json({
      success: false,
      message: message || "Failed to create identity",
      didlogic_error: didErr || null,
    });
  }
};

// ── DELETE /didlogic/kyc/identities/:id ───────────────────────────────────────
// Archives the identity in DIDLogic and marks it archived in our DB
const archiveIdentity = async (req, res) => {
  try {
    const didlogicId = Number(req.params.id);
    const userId     = req.user._id;

    // Verify this identity belongs to the requesting user
    const record = await DIDIdentity.findOne({ didlogicId, userId });
    if (!record) {
      return res.status(403).json({ success: false, message: "Identity not found or access denied." });
    }

    // Archive in DIDLogic
    await did.archiveIdentity(didlogicId);

    // Mark archived in our DB
    await DIDIdentity.findByIdAndUpdate(record._id, { archived: true });

    res.json({ success: true, message: "Identity archived." });
  } catch (err) {
    console.error("archiveIdentity error:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      success: false, message: err.response?.data?.message || err.message,
    });
  }
};

module.exports = {
  listDocuments,
  uploadDocument,
  getDocument,
  updateDocument,
  deleteDocument,
  listDocumentCountries,
  downloadDocumentFile,
  listIdentities,
  createIdentity,
  archiveIdentity,
};
