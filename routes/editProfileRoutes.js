const { Router } = require("express");
const { editProfile, addonsignals, testingOneSignal } = require("../controllers/editProfile");
const router = Router();

/**
 * @swagger
 * /editProfile:
 *   put:
 *     summary: Update user profile
 *     tags: [User]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstname:
 *                 type: string
 *               lastname:
 *                 type: string
 *               email:
 *                 type: string
 *               phonenumber:
 *                   type: object
 *                   properties:
 *                       countryCode:
 *                         type: string
 *                       number:
 *                         type: string
 *               profileImageURL:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 */
router.put("/", editProfile);

router.get("/testingonesignal", testingOneSignal);

module.exports = router;
