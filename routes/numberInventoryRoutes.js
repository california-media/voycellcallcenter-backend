const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/numberInventoryController");

// Countries (with flag via short_name ISO code)
router.get("/countries",                                          ctrl.getCountries);

// States / provinces for NANP countries (has_provinces_or_states=true)
router.get("/countries/:country_id/regions",                     ctrl.getRegions);

// Cities within a country
router.get("/countries/:country_id/cities",                      ctrl.getCities);

// Search locations by prefix
router.get("/countries/:country_id/locations",                   ctrl.getLocations);

// Available numbers for a city (paginated)
router.get("/countries/:country_id/cities/:city_id/numbers",     ctrl.getNumbersByCity);

// Returns the DIDLogic Bearer token for direct frontend calls
router.get("/token",                                             ctrl.getApiToken);

// Advanced search across all countries
router.get("/search",                                            ctrl.searchNumbers);

// Purchase a number — our backend verifies credits, calls DIDProvider, records the assignment
router.post("/purchase",                                         ctrl.purchaseNumber);

module.exports = router;
