const { Router } = require("express");
const { checkForAuthentication } = require("../middlewares/authentication");
const checkAccountStatus = require("../middlewares/checkAccountStatus");
const {
  signupWithEmail,
  verifyRealPhoneNumber,
  demoEmailSend,
  unifiedLogin,
  resendVerificationLink,
  logoutUser,
  generateMagicLink,
  loginWithMagicLink,
} = require("../controllers/companyAdminAuthController");
const { verifyEmailChange } = require("../controllers/admin/superAdminController");

const router = Router();

/**
 * @swagger
 * tags:
 *   name: User
 *   description: User authentication routes
 */

/**
 * @swagger
 * /user/signup:
 *   post:
 *     summary: Register a new user with email and password
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               firstname:
 *                 type: string
 *               lastname:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       409:
 *         description: User already registered
 */
// router.post("/signup/request-otp", requestOtp);

router.post("/signup/email", signupWithEmail);


router.post("/verify-phone-number", checkForAuthentication(), checkAccountStatus, verifyRealPhoneNumber);

router.post("/sendDemoEmail", checkForAuthentication(), checkAccountStatus, demoEmailSend);


router.post("/resendVerificationLink", resendVerificationLink);

router.post("/login/magic-link", loginWithMagicLink);

router.post("/generateMagicLink", generateMagicLink);

router.post("/verifyEmailChange", verifyEmailChange);




/**
 * @swagger
 * /user/login:
 *   post:
 *     summary: Login with email/password, Google, or Apple using a single endpoint
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "test@example.com"
 *               password:
 *                 type: string
 *                 example: "yourpassword"
 *               googleToken:
 *                 type: string
 *                 example: "GOOGLE_ID_TOKEN"
 *               appleToken:
 *                 type: string
 *                 example: "APPLE_ID_TOKEN"
 *             description: Provide email/password for standard login, or provide Google or Apple token. Only one method is required.
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Invalid login request
 *       401:
 *         description: Invalid email or password
 *       500:
 *         description: Login failed
 */
router.post("/login", unifiedLogin);

router.post("/logout", checkForAuthentication(), logoutUser);

module.exports = router;