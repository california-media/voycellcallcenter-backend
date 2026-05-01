const express = require("express");
const multer  = require("multer");
const router  = express.Router();
const ctrl    = require("../controllers/kycDocumentController");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file (DIDLogic spec)
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, and PDF files are allowed."));
    }
  },
});

// Two file slots: frontside (required) and backside (optional, personal_id only)
const uploadFields = upload.fields([
  { name: "frontside", maxCount: 1 },
  { name: "backside",  maxCount: 1 },
]);

// ── Identities ────────────────────────────────────────────────────────────────
router.get("/identities",          ctrl.listIdentities);    // list user's own identities
router.post("/identities",         ctrl.createIdentity);    // create + record ownership
router.delete("/identities/:id",   ctrl.archiveIdentity);   // archive in DIDLogic + DB

// ── Documents ─────────────────────────────────────────────────────────────────
// IMPORTANT: /documents/countries must come BEFORE /documents/:id
router.get("/documents/countries",          ctrl.listDocumentCountries);
router.get("/documents",                    ctrl.listDocuments);
router.post("/documents", uploadFields,     ctrl.uploadDocument);
router.get("/documents/:id",                ctrl.getDocument);
router.put("/documents/:id",                ctrl.updateDocument);
router.delete("/documents/:id",             ctrl.deleteDocument);
router.get("/documents/:id/files/:role",    ctrl.downloadDocumentFile);

module.exports = router;
