const { Router } = require("express");
const { getUserData, getAgents } = require("../controllers/getUserControllers");
const { checkForAuthentication } = require("../middlewares/authentication");
const checkAccountStatus = require("../middlewares/checkAccountStatus")

const router = Router();

/**
 * @swagger
 * /getUser:
 *   get:
 *     summary: Get user data
 *     tags: [User]
 *     responses:
 *       200:
 *         description: User fetched successfully
 */

router.post("/", checkAccountStatus,checkForAuthentication(), getUserData);
router.get("/getAgents", checkAccountStatus, getAgents);

module.exports = router;
