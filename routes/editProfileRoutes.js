const { Router } = require("express");
const {
  editProfile,
  updateContactStatuses,
  updateLeadStatuses,
} = require("../controllers/editProfile");
const router = Router();
const checkAccountStatus = require("../middlewares/checkAccountStatus")

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
router.put("/", checkAccountStatus, editProfile);

/**
 * @swagger
 * /editProfile/contact-statuses:
 *   put:
 *     summary: Update contact statuses
 *     tags: [User]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contactStatuses:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     value:
 *                       type: string
 *                     label:
 *                       type: string
 *     responses:
 *       200:
 *         description: Contact statuses updated successfully
 */
router.put("/contact-statuses", updateContactStatuses);

// router.get("/testingonesignal", testingOneSignal);

module.exports = router;
