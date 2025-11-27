const { changePassword, changeSipSecret } = require("../controllers/changePassword");
const { Router } = require("express");
const router = Router();
const checkAccountStatus = require("../middlewares/checkAccountStatus")

/**
 * @swagger
 * /api/v1/auth/change-password:
 *   post:
 *     summary: Change user password
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *                 description: User ID
 *               currentPassword:
 *                 type: string
 *                 description: Current password
 *               newPassword:
 *                 type: string
 *                 description: New password
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       401:
 *         description: Invalid current password
 */
router.post("/", checkAccountStatus,changePassword);

router.post("/sip-secret", checkAccountStatus,changeSipSecret)

module.exports = router;