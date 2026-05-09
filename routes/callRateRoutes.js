const express  = require("express");
const router   = express.Router();
const multer   = require("multer");
const ctrl     = require("../controllers/callRateController");
const { checkForAuthentication } = require("../middlewares/authentication");
const checkRole                   = require("../middlewares/roleCheck");

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    // Accept CSV only — xlsx is not needed (no xlsx dependency in backend)
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) cb(null, true);
    else cb(new Error("Only .csv files are accepted. Please save your spreadsheet as CSV first."));
  },
});

// ── Public to authenticated users ─────────────────────────────────────────
router.get("/",             checkForAuthentication(), ctrl.getCallRates);

// ── Superadmin only ────────────────────────────────────────────────────────
router.get("/config",       checkForAuthentication(), checkRole(["superadmin"]), ctrl.getConfig);
router.put("/config",       checkForAuthentication(), checkRole(["superadmin"]), ctrl.updateConfig);
router.post("/",            checkForAuthentication(), checkRole(["superadmin"]), ctrl.createCallRate);
router.put("/:id",          checkForAuthentication(), checkRole(["superadmin"]), ctrl.updateCallRate);
router.delete("/:id",       checkForAuthentication(), checkRole(["superadmin"]), ctrl.deleteCallRate);
router.post("/upload",      checkForAuthentication(), checkRole(["superadmin"]), upload.single("file"), ctrl.uploadCallRates);

module.exports = router;
