const { Router } = require("express");
const {
  editProfile,
  updateContactStatuses,
  updateLeadStatuses,
} = require("../controllers/editProfile");
const User = require("../models/userModel");
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

// Dismiss the setup guide — persists across devices
router.patch("/setup-guide-dismiss", checkAccountStatus, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { setupGuideDismissed: true });
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Self-service caller preferences (company admin & agent edit their own)
router.patch("/caller-preferences", checkAccountStatus, async (req, res) => {
  try {
    const { defaultCallerNumber, askBeforeDialing, showCallerName } = req.body;
    const update = {};
    if (defaultCallerNumber !== undefined) update.defaultCallerNumber = defaultCallerNumber || null;
    if (askBeforeDialing    !== undefined) update.askBeforeDialing    = !!askBeforeDialing;
    if (showCallerName      !== undefined) {
      const valid = ["number", "name", "name_number"];
      update.showCallerName = valid.includes(showCallerName) ? showCallerName : "number";
    }
    const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, {
      new: true, select: "defaultCallerNumber askBeforeDialing showCallerName",
    });
    res.json({ status: "success", defaultCallerNumber: user.defaultCallerNumber, askBeforeDialing: user.askBeforeDialing, showCallerName: user.showCallerName });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Company admin updates DID number labels (nicknames for purchased numbers)
router.patch("/did-labels", checkAccountStatus, async (req, res) => {
  try {
    const { didLabels } = req.body; // [{ number, nickname }]
    if (!Array.isArray(didLabels)) return res.status(400).json({ status: "error", message: "didLabels must be an array" });
    const cleaned = didLabels
      .filter((d) => d.number)
      .map((d) => ({ number: String(d.number).trim(), nickname: d.nickname ? String(d.nickname).trim() : null }));
    const user = await User.findByIdAndUpdate(req.user._id, { $set: { didLabels: cleaned } }, {
      new: true, select: "didLabels",
    });
    res.json({ status: "success", didLabels: user.didLabels });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

module.exports = router;
