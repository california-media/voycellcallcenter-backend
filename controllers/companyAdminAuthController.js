const { OAuth2Client } = require("google-auth-library");
const { createTokenforUser } = require("../services/authentication");
const User = require("../models/userModel");
const crypto = require("crypto");
const { randomBytes, createHmac } = require("crypto");
// const { randomBytes } = require("crypto");
const { sendVerificationEmail, sendMagicLinkEmail } = require("../utils/emailUtils");
const googleClient = new OAuth2Client(
  "401067515093-9j7faengj216m6uc9csubrmo3men1m7p.apps.googleusercontent.com"
);
const { normalizePhone } = require("../utils/phoneUtils");
require("dotenv").config();
const { google } = require("googleapis");
const querystring = require("querystring");
const axios = require("axios");
const ReferralLog = require("../models/referralLogModel");
const { createYeastarExtensionForUser } = require("../utils/yeastarClient");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_LOGIN_URI // e.g. https://yourapi.com/auth/google/callback
);

const disallowedEmailDomains = [
  // "gmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "aol.com",
  "mail.com",
  "gmx.com",
  "protonmail.com",
  "zoho.com",
  "yandex.com",
  "tutanota.com",
  "fastmail.com",
  "hushmail.com",
  "inbox.com",
  "lycos.com",
];

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Requires: User and ReferralLog models in scope.
// Put this near top of your controller file:
async function addOrUpdateReferral(referrerId, referredUser) {
  if (!referrerId || !referredUser || !referredUser._id) return null;

  // Fetch fresh referrer doc
  const referrer = await User.findById(referrerId);
  if (!referrer) return null;

  // Normalize phone objects from referredUser
  const phoneObjs = Array.isArray(referredUser.phonenumbers)
    ? referredUser.phonenumbers.map((p) => ({
      countryCode: (p.countryCode || "").toString().replace(/^\+/, ""),
      number: (p.number || "").toString().replace(/^\+/, ""),
    }))
    : [];

  const referredIdStr = referredUser._id.toString();

  // Find existing entry index (works if myReferrals contains objects or just ids)
  const index = (referrer.myReferrals || []).findIndex((item) => {
    if (!item) return false;
    if (typeof item === "object" && item._id)
      return item._id.toString() === referredIdStr;
    // if stored as raw id string
    try {
      return item.toString() === referredIdStr;
    } catch (e) {
      return false;
    }
  });

  let now = new Date();
  let needSaveReferrer = false;
  console.log("referrer index is", index);
  if (index !== -1) {
    // Update missing fields on existing entry
    const entry = referrer.myReferrals[index];
    if (!entry.firstname && referredUser.firstname) {
      entry.firstname = referredUser.firstname;
      needSaveReferrer = true;
    }
    if (!entry.lastname && referredUser.lastname) {
      entry.lastname = referredUser.lastname;
      needSaveReferrer = true;
    }
    if ((!entry.email || entry.email === "") && referredUser.email) {
      entry.email = referredUser.email;
      needSaveReferrer = true;
    }

    if (
      (!Array.isArray(entry.phonenumbers) || entry.phonenumbers.length === 0) &&
      phoneObjs.length
    ) {
      entry.phonenumbers = phoneObjs;
      needSaveReferrer = true;
    }
    if (!entry.signupDate && referredUser.createdAt) {
      entry.signupDate = referredUser.createdAt;
      needSaveReferrer = true;
    }

    // markModified if subdoc changed
    if (needSaveReferrer) referrer.markModified("myReferrals");
  } else {
    // Push new consistent object
    const newEntry = {
      _id: referredUser._id,
      firstname: referredUser.firstname || "",
      lastname: referredUser.lastname || "",
      email: referredUser.email || "",
      phonenumbers: phoneObjs,
      signupDate: referredUser.createdAt || now,
    };
    console.log("new referral entry is", newEntry);
    referrer.myReferrals = referrer.myReferrals || [];
    referrer.myReferrals.push(newEntry);
    needSaveReferrer = true;
  }

  // Save referrer if any changes were made to myReferrals
  if (needSaveReferrer) {
    await referrer.save();
  }

  // Credit logic is now handled in signupWithEmail to avoid race conditions

  // Create ReferralLog if not exists (by email or phone)
  try {
    const orQueries = [];
    if (referredUser.email) orQueries.push({ email: referredUser.email });
    if (phoneObjs.length) {
      // use elemMatch to find same phone
      orQueries.push({
        phonenumbers: {
          $elemMatch: {
            countryCode: phoneObjs[0].countryCode,
            number: phoneObjs[0].number,
          },
        },
      });
    }
    if (orQueries.length) {
      const existingLog = await ReferralLog.findOne({ $or: orQueries });
      if (!existingLog) {
        const log = {
          referredBy: referrer._id,
          referredUserId: referredUser._id,
          signupDate: referredUser.createdAt || now,
        };
        if (referredUser.email) log.email = referredUser.email;
        if (phoneObjs.length) log.phonenumbers = phoneObjs;
        await ReferralLog.create(log);
      }
    }
  } catch (err) {
    console.error("ReferralLog create error:", err.message);
  }

  return true;
}

const signupWithEmail = async (req, res) => {
  try {
    const {
      email = "",
      password,
      firstname = "",
      lastname = "",
      verifyToken = "",
    } = req.body;

    const referralCodeParam = req.body.referralCode || req.query.ref || "";

    // === PART 1: Email Verification Flow ===
    if (verifyToken) {
      const user = await User.findOne({ emailVerificationToken: verifyToken });

      if (!user) {
        return res.status(400).json({
          status: "error",
          message: "Invalid or expired verification token",
        });
      }

      user.isVerified = true;
      user.emailVerificationToken = undefined;

      if (!user.signupMethod) {
        user.signupMethod = "email";
      }

      // === PART 3: Yeastar Extension Creation ===
      try {
        // Start extension creation after user is verified
        const startExt = parseInt(process.env.EXTENSION_START || "1001", 10);
        const maxAttempts = parseInt(
          process.env.EXTENSION_MAX_ATTEMPTS || "500",
          10
        );

        const nameForExtension =
          `${user.firstname || ""} ${user.lastname || ""}`.trim() || user.email;

        // Attempt to create Yeastar extension
        const { extensionNumber, secret, result } =
          await createYeastarExtensionForUser(user);

        // If response not OK, throw manually
        if (!extensionNumber || !result || result.errcode !== 0) {
          throw new Error(
            result?.errmsg || "Yeastar extension creation failed"
          );
        }

        // ✅ Save extension details in user
        user.extensionNumber = extensionNumber;
        user.yeastarExtensionId = result?.data?.id || result?.id || null;
        user.sipSecret = secret;
        await user.save();

        console.log("✅ Yeastar extension created:", extensionNumber);
      } catch (err) {
        console.error("❌ Yeastar extension creation failed:", err.message);

        // Cleanup: delete the user since extension provisioning failed
        await User.findByIdAndDelete(user._id);

        return res.status(500).json({
          status: "error",
          message: `Signup failed: Yeastar extension could not be created (${err.message})`,
        });
      }

      // Setup initial plan after email verification (skip for superadmin)
      if (user.role !== "superadmin") {
        if (user.referredBy) {
          // Add $10 referral credits to the current user's cache
          try {
            console.log(
              `Added $10 welcome credit to user cache for user ${user._id}`
            );
          } catch (error) {
            console.error("Error adding welcome credit to user cache:", error);
          }

          // Add $10 referral credits to the referring user's cache if exists
          try {
            const referringUser = await User.findById(user.referredBy);
            if (referringUser) {
              console.log(
                `Added $10 referral credit to referring user cache ${user.referredBy}`
              );
            }
          } catch (error) {
            console.error(
              "Error adding referral credits to referring user:",
              error
            );
          }
        }
      }

      // Activate user after email verification
      user.isActive = true;

      // ✅ Optional: Update scannedMe for other users
      await user.save();

      const token = createTokenforUser(user);

      return res.status(200).json({
        status: "success",
        message: "Email verified successfully. You can now log in.",
        data: {
          token,
          registeredWith: user.signupMethod,
        },
      });
    }

    // === PART 2: Initial Signup (Before Verification) ===

    // === BLOCK PUBLIC EMAIL PROVIDERS ===
    const emailDomain = email.split("@")[1]?.toLowerCase();
    if (!emailDomain) {
      return res.status(400).json({
        status: "error",
        message: "Invalid email format",
      });
    }

    if (disallowedEmailDomains.includes(emailDomain)) {
      return res.status(400).json({
        status: "error",
        message: `Registration using ${emailDomain} is not allowed. Please use your company or custom domain email.`,
      });
    }

    if (!password || !email) {
      return res.status(400).json({
        status: "error",
        message: "Password and email are required",
      });
    }

    const trimmedEmail = email.trim();

    // Check if email already exists
    const existingUser = await User.findOne({ email: trimmedEmail });
    if (existingUser) {
      return res.status(409).json({
        status: "error",
        message: "User with this email already exists",
      });
    }

    // Generate Email Verification Token
    const emailVerificationToken = crypto.randomBytes(32).toString("hex");

    const referralCodeRaw = email + Date.now();
    const referralCode = crypto
      .createHash("sha256")
      .update(referralCodeRaw)
      .digest("hex")
      .slice(0, 16);

    let referredBy = null;
    if (referralCodeParam) {
      const referringUser = await User.findOne({
        referralCode: referralCodeParam,
      });

      const previouslyReferred = await ReferralLog.findOne({
        email: trimmedEmail,
      });

      if (previouslyReferred) {
        return res.status(400).json({
          status: "error",
          message:
            "This referral link has already been used with this email. Please sign up manually.",
        });
      }

      referredBy = referringUser._id;
      // }
    }

    // Create new user without plan (plan will be assigned after email verification)
    const newUser = await User.create({
      email: trimmedEmail,
      password,
      firstname,
      lastname,
      isVerified: false,
      signupMethod: "email",
      role: "companyAdmin",
      emailVerificationToken,
      referralCode, // 🔥 store user’s unique referral code
      isActive: true, // User is not active until email verification
      referredBy,
    });

    if (referredBy) {
      const referrer = await User.findById(referredBy);
      await ReferralLog.create({
        email: newUser.email,
        referredBy: referredBy,
        referredUserId: newUser._id,
      });
      if (referrer) {
        await addOrUpdateReferral(referredBy, newUser);
      }
    }

    let referUrl = `${FRONTEND_URL}/register?ref=${newUser.referralCode}`;

    let verificationLink = "";

    if (referralCodeParam) {
      verificationLink = `${FRONTEND_URL}/user-verification?verificationToken=${newUser.emailVerificationToken}&ref=${referralCodeParam}`;
    } else {
      verificationLink = `${FRONTEND_URL}/user-verification?verificationToken=${newUser.emailVerificationToken}`;
    }

    // Send verification email

    await sendVerificationEmail(newUser.email, verificationLink);

    console.log("Verification Link:", verificationLink);

    // newUser.isActive = true; // mark as active

    return res.status(201).json({
      status: "success",
      message:
        "Signup started. Please verify your email to activate your account.",
      data: {
        _id: newUser._id,
        email: newUser.email,
        registeredWith: newUser.signupMethod,
        referUrl,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    return res.status(500).json({
      status: "error",
      message: "Signup failed",
      error: error.message,
    });
  }
};

const resendVerificationLink = async (req, res) => {
  try {
    const { email = "" } = req.body;

    if (!email || email.trim() === "") {
      return res.status(400).json({
        status: "error",
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User with this email does not exist",
      });
    }

    if (user.isVerified) {
      return res.status(400).json({
        status: "error",
        message: "Email is already verified",
      });
    }

    // Generate new token and save
    user.emailVerificationToken = crypto.randomBytes(32).toString("hex");
    await user.save();

    // Build link and send email
    const verificationLink = `${FRONTEND_URL}/user-verification?verificationToken=${user.emailVerificationToken}`;
    await sendVerificationEmail(user.email, verificationLink);

    return res.status(200).json({
      status: "success",
      message: "Verification email resent successfully",
      verificationLink,
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to resend verification link",
      error: error.message,
    });
  }
};

const signupWithPhoneNumber = async (req, res) => {
  try {
    const {
      countryCode,
      phonenumber,
      password,
      otp,
      firstname,
      lastname,
      resendOtp = false,
      apiType = "mobile",
    } = req.body;

    const referralCodeParam = req.body.referralCode || req.query.ref || "";

    if (!phonenumber || !password) {
      return res.status(400).json({
        status: "error",
        message: "Phone number and password are required",
      });
    }

    // ---------- NORMALIZE PHONE ----------
    // Use our helper which understands both "mobile" (separate cc + number)
    // and "web" (combined like "917046658651").
    const { countryCode: sanitizedCountryCode, number: sanitizedNumber } =
      normalizePhone({ phonenumber, countryCode, apiType });

    if (!sanitizedNumber) {
      return res.status(400).json({
        status: "error",
        message:
          "Unable to parse phone number. Please include country code or send valid phone.",
      });
    }

    // ---------- find existing user by structured phonenumbers ----------
    let user = await User.findOne({
      phonenumbers: {
        $elemMatch: {
          countryCode: sanitizedCountryCode,
          number: sanitizedNumber,
        },
      },
    });

    const generateOtp = () =>
      Math.floor(100000 + Math.random() * 900000).toString();

    // === Step 1: No OTP or resendOtp -> generate/send OTP ===
    if (!otp || resendOtp) {
      if (user && user.isVerified && !resendOtp) {
        return res.status(409).json({
          status: "error",
          message: "User with this phone number already exists. Please login.",
        });
      }

      const generatedOtp = generateOtp();
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
      const tempSerialNumber = Date.now() + Math.floor(Math.random() * 1000);

      user = await User.findOneAndUpdate(
        {
          phonenumbers: {
            $elemMatch: {
              countryCode: sanitizedCountryCode,
              number: sanitizedNumber,
            },
          },
        },
        {
          $setOnInsert: { serialNumber: tempSerialNumber },
          $set: {
            otp: generatedOtp,
            otpExpiresAt,
            firstname,
            lastname,
            signupMethod: "phoneNumber",
            phonenumbers: [
              { countryCode: sanitizedCountryCode, number: sanitizedNumber },
            ],
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      try {
        const phoneForWhatsAppApi = `+${sanitizedCountryCode}${sanitizedNumber}`;
        await sendWhatsAppOtp(phoneForWhatsAppApi, generatedOtp);
      } catch (error) {
        console.error(
          "OTP Send Failed ❌",
          error.response?.data || error.message
        );
        return res.status(500).json({
          status: "error",
          message: "Failed to send WhatsApp OTP",
          error: error.response?.data || error.message,
        });
      }

      return res.status(200).json({
        status: "pending",
        message: resendOtp
          ? "OTP resent to your WhatsApp number"
          : "OTP sent to your WhatsApp number",
      });
    }

    // === Step 2: OTP present -> verify/create user ===
    if (!user) {
      return res.status(400).json({
        status: "error",
        message:
          "No signup request found for this phone number. Please request a new OTP.",
      });
    }

    if (user.isVerified) {
      return res.status(409).json({
        status: "error",
        message: "User with this phone number already verified. Please login.",
      });
    }

    if (user.otp !== otp) {
      return res.status(400).json({
        status: "error",
        message: "Invalid OTP",
      });
    }

    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({
        status: "error",
        message: "OTP has expired. Please request a new OTP.",
      });
    }

    // OTP valid → finalize signup
    const serialNumber = await User.getNextSerialNumber();
    let userDetails = user.toObject();

    // strip sensitive
    delete userDetails.password;
    delete userDetails.otp;
    delete userDetails.otpExpiresAt;
    delete userDetails.emailVerificationToken;
    delete userDetails.resetPasswordToken;
    delete userDetails.resetPasswordExpires;

    // set final fields consistently
    userDetails.serialNumber = serialNumber;
    userDetails.firstname = firstname;
    userDetails.lastname = lastname;
    userDetails.phonenumbers = [
      { countryCode: sanitizedCountryCode, number: sanitizedNumber },
    ];
    userDetails.signupMethod = "phoneNumber";
    userDetails.provider = "local";

    // finalize user object
    user.serialNumber = serialNumber;
    user.isVerified = true;
    user.signupMethod = "phoneNumber";
    user.role = "companyAdmin";
    user.password = password;
    user.firstname = firstname;
    user.lastname = lastname;

    // clear OTP
    user.otp = undefined;
    user.otpExpiresAt = undefined;

    // ---------- scannedMe / iScanned matching ----------
    const matchConditions = [];
    if (user.email) matchConditions.push({ email: user.email });
    if (user.phonenumbers?.[0]) {
      matchConditions.push({
        phonenumbers: {
          $elemMatch: {
            countryCode: user.phonenumbers[0].countryCode,
            number: user.phonenumbers[0].number,
          },
        },
      });
    }

    if (matchConditions.length > 0) {
      const matchingUsers = await User.find({
        scannedMe: { $elemMatch: { $or: matchConditions } },
      });

      // helper to compare various stored formats
      const equalPhone = (entryPhone, userPhoneObj) => {
        if (!entryPhone) return false;
        // entryPhone can be string or object
        if (typeof entryPhone === "string") {
          const raw = entryPhone.replace(/\D/g, "");
          const u = `${userPhoneObj.countryCode}${userPhoneObj.number}`;
          return raw === u || raw === userPhoneObj.number || raw === `+${u}`;
        }
        if (
          typeof entryPhone === "object" &&
          entryPhone.countryCode &&
          entryPhone.number
        ) {
          return (
            entryPhone.countryCode === userPhoneObj.countryCode &&
            entryPhone.number === userPhoneObj.number
          );
        }
        return false;
      };

      for (const scanner of matchingUsers) {
        let updated = false;

        scanner.scannedMe = scanner.scannedMe.map((entry) => {
          if (
            typeof entry === "object" &&
            ((entry.email && entry.email === user.email) ||
              (entry.phonenumber &&
                equalPhone(entry.phonenumber, user.phonenumbers[0])))
          ) {
            updated = true;
            return user._id;
          }
          return entry;
        });

        if (updated) await scanner.save();

        if (!Array.isArray(user.iScanned)) user.iScanned = [];

        const alreadyAdded = user.iScanned.some((entry) => {
          if (typeof entry === "object" && entry._id)
            return entry._id.toString() === scanner._id.toString();
          return entry.toString() === scanner._id.toString();
        });

        if (!alreadyAdded) {
          user.iScanned.push({
            _id: scanner._id,
            firstname: scanner.firstname || "",
            lastname: scanner.lastname || "",
            email: scanner.email || "",
            phonenumbers: scanner.phonenumbers || [],
            profileImageURL: scanner.profileImageURL || "",
          });
        }
      }
    }

    // Plan is now derived from subscription, no need to store in user

    const referralCodeRaw = `${sanitizedCountryCode}${sanitizedNumber}${Date.now()}`;
    user.referralCode = crypto
      .createHash("sha256")
      .update(referralCodeRaw)
      .digest("hex")
      .slice(0, 16);

    if (referralCodeParam) {
      const referringUser = await User.findOne({
        referralCode: referralCodeParam,
      });

      const previouslyReferred = await ReferralLog.findOne({
        phonenumbers: {
          $elemMatch: {
            countryCode: sanitizedCountryCode,
            number: sanitizedNumber,
          },
        },
      });

      if (
        previouslyReferred &&
        previouslyReferred.referredUserId?.toString() !== user._id.toString()
      ) {
        return res.status(400).json({
          status: "error",
          message:
            "This referral link has already been used with this phone number. Please sign up manually.",
        });
      }

      // if (referringUser) {
      //   user.referredBy = referringUser._id;
      //   referringUser.myReferrals.push({
      //     _id: user._id,
      //     firstname: user.firstname,
      //     lastname: user.lastname,
      //     email: user.email,
      //     phonenumbers: user.phonenumbers,
      //     signupDate: new Date(),
      //   });

      //   referringUser.creditBalance = (referringUser.creditBalance || 0) + 10;
      //   user.creditBalance = (user.creditBalance || 0) + 10;
      //   await referringUser.save();

      //   await ReferralLog.create({
      //     phonenumbers: [{ countryCode: sanitizedCountryCode, number: sanitizedNumber }],
      //     referredBy: referringUser._id,
      //     referredUserId: user._id,
      //   });
      // }

      if (referringUser) {
        user.referredBy = referringUser._id;

        // referringUser.myReferrals.push({
        //   _id: user._id,
        //   firstname: user.firstname || "",
        //   lastname: user.lastname || "",
        //   email: user.email || "",
        //   phonenumbers: Array.isArray(user.phonenumbers)
        //     ? user.phonenumbers.map(p => ({
        //       countryCode: (p.countryCode || "").toString().replace(/^\+/, ""),
        //       number: (p.number || "").toString().replace(/^\+/, "")
        //     }))
        //     : [],
        //   signupDate: new Date(),
        // });

        // referringUser.creditBalance = (referringUser.creditBalance || 0) + 10;
        // user.creditBalance = (user.creditBalance || 0) + 10;
        // await referringUser.save();
        await addOrUpdateReferral(referringUser._id, user);

        await ReferralLog.create({
          phonenumbers: [
            { countryCode: sanitizedCountryCode, number: sanitizedNumber },
          ],
          referredBy: referringUser._id,
          referredUserId: user._id,
        });
      }
    }
    user.isActive = true; // mark as active

    await user.save();

    const token = createTokenforUser(user);
    const referUrl = `${FRONTEND_URL}/register?ref=${user.referralCode}`;

    return res.status(201).json({
      status: "success",
      message: "Phone signup completed successfully",
      data: {
        _id: user._id,
        token,
        registeredWith: user.signupMethod,
        referUrl,
      },
    });
  } catch (error) {
    console.error("Signup Error ❌", error);
    return res.status(500).json({
      status: "error",
      message: "Server error during signup",
      error: error.message,
    });
  }
};

const unifiedLogin = async (req, res) => {
  try {
    const {
      email = "",
      password = "",
    } = req.body;

    if (email && password) {
      try {
        const trimmedEmail = email?.trim()?.toLowerCase();

        // Build query conditions
        const queryConditions = [];
        if (trimmedEmail) queryConditions.push({ email: trimmedEmail });

        if (queryConditions.length === 0) {
          return res.status(400).json({
            status: "error",
            message: "Email is required",
          });
        }

        const user = await User.findOne({ $or: queryConditions });

        if (!user) {
          return res
            .status(401)
            .json({ status: "error", message: "User not found" });
        }

        // If logging in by email, require email verification
        if (trimmedEmail && !user.isVerified) {
          return res.status(403).json({
            status: "error",
            message: "Please verify your email before logging in",
          });
        }

        if (user.accountStatus === "deactivated") {
          return res.status(403).json({
            status: "error",
            message: "Your account deactivated. Please contact support.",
          });
        }

        if (user.accountStatus === "suspended") {
          return res.status(403).json({
            status: "error",
            message: "Your account suspended. Please contact support.",
          });
        }

        if (user.signupMethod === "email" && !trimmedEmail) {
          return res.status(400).json({
            status: "error",
            message:
              "This user signed up with email. Please login with email and password.",
          });
        }


        // ✅ MANUAL PASSWORD CHECK
        const hash = createHmac("sha256", user.salt)
          .update(password)
          .digest("hex");

        if (hash !== user.password) {
          return res.status(401).json({
            status: "error",
            message: "Invalid credentials",
          });
        }

        // ✅ CREATE NEW SESSION (DESTROYS OLD LOGIN)
        const newSessionId = randomBytes(32).toString("hex");

        user.activeSessionId = newSessionId;
        user.isActive = true;
        user.lastSeen = new Date();
        await user.save();
        console.log(newSessionId);

        // ✅ CREATE NEW TOKEN WITH SESSION ID
        const token = createTokenforUser(user);

        const now = new Date();
        user.isActive = true; // mark as active
        return res.json({
          status: "success",
          message: "Login successful",
          data: {
            token,
            registeredWith: user.signupMethod,
            role: user.role || "user",
          },
        });
      } catch (err) {
        console.log("Login error:", err);
        return res.status(401).json({
          status: "error",
          message: err.message || "Invalid credentials",
        });
      }
    }
    return res
      .status(400)
      .json({ status: "error", message: "Invalid login request" });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ status: "error", message: "Login failed" });
  }
};

const generateMagicLink = async (req, res) => {
  try {
    // const userId = req.user._id; // ✅ from auth middleware

    const email = req.body.email;

    const user = await User.findOne({ email: email });
    const userId = user ? user._id : null;
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // ✅ Find user email
    // const user = await User.findById(userId).select("email");

    if (!user || !user.email) {
      return res.status(400).json({
        status: "error",
        message: "User email not found",
      });
    }

    // ✅ Generate secure token
    const magicToken = randomBytes(32).toString("hex");

    // ✅ Set expiry (10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // ✅ Save token to DB
    await User.findByIdAndUpdate(userId, {
      magicLoginToken: magicToken,
      magicLoginExpires: expiresAt,
    });

    // ✅ Create full magic link
    const magicLink = `${process.env.FRONTEND_URL}/link-login?token=${magicToken}`;

    // ✅ SEND MAGIC LINK TO USER EMAIL ✅✅✅
    await sendMagicLinkEmail(user.email, magicLink);

    return res.json({
      status: "success",
      message: "Magic login link sent to your email successfully",
      magicLink, // for testing purposes
      magicToken,
      expiresAt,
    });
  } catch (err) {
    console.log("Magic link error:", err);
    return res.status(500).json({
      status: "error",
      message: "Failed to generate magic link",
    });
  }
};

const loginWithMagicLink = async (req, res) => {
  try {
    // const { magicLink } = req.body;

    // // ✅ 1. CHECK FULL LINK IS PROVIDED
    // if (!magicLink) {
    //   return res.status(400).json({
    //     status: "error",
    //     message: "Magic link is required",
    //   });
    // }

    const { token, magicLink } = req.body;

    const magicToken = ""

    if (magicLink && !token) {
      // ✅ 2. EXTRACT TOKEN FROM FULL URL
      try {
        const url = new URL(magicLink);
        token = url.searchParams.get("token");
      } catch (err) {
        return res.status(400).json({
          status: "error",
          message: "Invalid magic link format",
        });
      }
    } else if (token) {
      magicToken = token;
    } else {
      return res.status(400).json({
        status: "error",
        message: "Magic link or token is required",
      });
    }

    if (!magicToken) {
      return res.status(400).json({
        status: "error",
        message: "Magic token not found in link",
      });
    }

    // ✅ 3. FIND USER USING TOKEN
    const user = await User.findOne({
      magicLoginToken: magicToken,
      magicLoginExpires: { $gt: new Date() }, // ✅ must not be expired
    });

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Invalid or expired magic link",
      });
    }

    // ✅ 4. DESTROY OLD SESSION (LOGOUT OLD DEVICE)
    const newSessionId = randomBytes(32).toString("hex");

    user.activeSessionId = newSessionId;
    user.isActive = true;
    user.lastSeen = new Date();

    // ✅ 5. DELETE MAGIC TOKEN (ONE-TIME USE)
    user.magicLoginToken = null;
    user.magicLoginExpires = null;

    await user.save();

    // ✅ 6. CREATE NEW JWT
    const jwtToken = createTokenforUser(user);

    return res.json({
      status: "success",
      message: "Login successful via magic link",
      data: {
        token: jwtToken,
        role: user.role,
        registeredWith: user.signupMethod,
      },
    });
  } catch (err) {
    console.log("Magic login error:", err);
    return res.status(500).json({
      status: "error",
      message: "Magic link login failed",
    });
  }
};

const logoutUser = async (req, res) => {
  try {
    console.log("hello");

    const userId = req.user._id; // requires auth middleware
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ message: "User not found" });

    user.isActive = false; // mark as inactive
    user.lastSeen = new Date();
    await user.save();

    res.json({ message: "Logout successful" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  signupWithEmail,
  signupWithPhoneNumber,
  unifiedLogin,
  resendVerificationLink,
  logoutUser,
  generateMagicLink,
  loginWithMagicLink,
};
