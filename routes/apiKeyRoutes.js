const { Router } = require("express");
const { checkForAuthentication } = require("../middlewares/authentication");
const {
  generateApiKey,
  getCurrentApiKey,
} = require("../controllers/apiKeyController");

const router = Router();

/**
 * @swagger
 * tags:
 *   name: API Key
 *   description: API key management routes
 */

/**
 * @swagger
 * /api-key/generate:
 *   post:
 *     summary: Generate a new API key for the authenticated user
 *     tags: [API Key]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: API key generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 message:
 *                   type: string
 *                   example: API key generated successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     apiKey:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                     userId:
 *                       type: string
 *                       example: 64f7d8e9b1234567890abcde
 *                     email:
 *                       type: string
 *                       example: user@example.com
 *                     generatedAt:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.post("/generate", generateApiKey);

/**
 * @swagger
 * /api-key/current:
 *   get:
 *     summary: Get current API key for the authenticated user
 *     tags: [API Key]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: API key retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 message:
 *                   type: string
 *                   example: API key retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     apiKey:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                     userId:
 *                       type: string
 *                       example: 64f7d8e9b1234567890abcde
 *                     email:
 *                       type: string
 *                       example: user@example.com
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.get("/current", getCurrentApiKey);

module.exports = router;
