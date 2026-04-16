const express = require("express");
const router = express.Router();
const { getApiLogs, getApiLogStats, getApiLogTimeSeries, getDistinctRoutes, deleteApiLog, deleteSelectedLogs, clearAllLogs } = require("../../controllers/admin/apiLogsController");

router.get("/", getApiLogs);
router.get("/stats", getApiLogStats);
router.get("/timeseries", getApiLogTimeSeries);
router.get("/routes", getDistinctRoutes);
router.delete("/clear", clearAllLogs);
router.delete("/batch", deleteSelectedLogs);
router.delete("/:logId", deleteApiLog);

module.exports = router;
