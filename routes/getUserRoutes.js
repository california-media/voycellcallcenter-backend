const { Router } = require("express");
const { getUserData } = require("../controllers/getUserControllers");
const { checkForAuthentication } = require("../middlewares/authentication");

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

router.post("/", checkForAuthentication(), getUserData);

module.exports = router;
