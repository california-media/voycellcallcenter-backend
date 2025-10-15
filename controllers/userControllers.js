const { OAuth2Client } = require("google-auth-library");
const { createTokenforUser } = require("../services/authentication");
const User = require("../models/userModel");
const crypto = require("crypto");
const { sendVerificationEmail } = require("../utils/emailUtils");
const googleClient = new OAuth2Client(
  "401067515093-9j7faengj216m6uc9csubrmo3men1m7p.apps.googleusercontent.com"
);
const { normalizePhone } = require("../utils/phoneUtils");
require("dotenv").config();
const { google } = require("googleapis");
const querystring = require("querystring");
const axios = require("axios");
const ReferralLog = require("../models/referralLogModel");


const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_LOGIN_URI // e.g. https://yourapi.com/auth/google/callback
);

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
  // if (needSaveReferrer) {
  //   // Add credits to referrer using Stripe billing credits
  //   try {
  //     const referrerCustomer = await getOrCreateStripeCustomer(referrer);
  //     await addStripeCredits(
  //       referrerCustomer.id,
  //       1000,
  //       "Referral bonus - new user signup"
  //     ); // $10 in cents
  //     console.log(
  //       `Added $10 credit to referrer ${referrer._id} for referring ${referredUser._id}`
  //     );
  //   } catch (error) {
  //     console.error("Error adding Stripe credits to referrer:", error);
  //   }
  //   await referrer.save();
  // }

  // // Also add credit to referredUser
  // try {
  //   const referredCustomer = await getOrCreateStripeCustomer(referredUser);
  //   await addStripeCredits(
  //     referredCustomer.id,
  //     1000,
  //     "Welcome bonus - signup with referral"
  //   ); // $10 in cents
  //   console.log(`Added $10 welcome credit to new user ${referredUser._id}`);
  // } catch (error) {
  //   console.error("Error adding Stripe credits to referred user:", error);
  // }

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
    // const tenantId = req.query.tenantId || req.body.tenantId || "";

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

      // Setup initial plan after email verification (skip for superadmin)
      if (user.role !== "superadmin") {
        if (user.referredBy) {
          // Add $10 referral credits to the current user's cache (will be applied to Stripe on first purchase)
          try {
            // Update cache_credits instead of adding directly to Stripe
            user.cache_credits = (user.cache_credits || 0) + 10;
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
              // Check if referring user has made their first purchase
              let hasFirstPurchase = false;
              // if (referringUser.stripeCustomerId) {
              //   hasFirstPurchase = await hasUserMadeFirstPurchase(
              //     referringUser.stripeCustomerId
              //   );
              // }

              if (hasFirstPurchase) {
                // Add directly to Stripe customer account
                // const referrerCustomer = await getOrCreateStripeCustomer(
                //   referringUser
                // );
                // await addStripeCredits(
                //   referrerCustomer.id,
                //   1000, // $10 in cents
                //   `Referral bonus - ${
                //     user.firstname || "User"
                //   } verified their email`
                // );
                // console.log(
                //   `Added $10 referral credit directly to Stripe for referring user ${user.referredBy}`
                // );
              } else {
                // Add to cache_credits
                referringUser.cache_credits =
                  (referringUser.cache_credits || 0) + 10;
                await referringUser.save();
                console.log(
                  `Added $10 referral credit to referring user cache ${user.referredBy}`
                );
              }
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
      role: "user",
      emailVerificationToken,
      referralCode, // 🔥 store user’s unique referral code
      isActive: true, // User is not active until email verification
      referredBy,
    });

    // No plan assignment here - will be done after email verification

    if (referredBy) {
      const referrer = await User.findById(referredBy);
      await ReferralLog.create({
        email: newUser.email,
        referredBy: referredBy,
        referredUserId: newUser._id,
      });
      if (referrer) {
        console.log("calling add or upate referral");
        await addOrUpdateReferral(referredBy, newUser);
      }
    }

    console.log(newUser.creditBalance);

    let referUrl = `https://demo.contacts.management/register?ref=${newUser.referralCode}`;

    let verificationLink = "";

    if (referralCodeParam) {
      verificationLink = `https://demo.contacts.management/user-verification?verificationToken=${newUser.emailVerificationToken}&ref=${referralCodeParam}`;
    } else {
      verificationLink = `https://demo.contacts.management/user-verification?verificationToken=${newUser.emailVerificationToken}`;
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
    const verificationLink = `https://demo.contacts.management/user-verification?verificationToken=${user.emailVerificationToken}`;
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
    user.role = "user";
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

    // Setup initial plan using utility (skip for superadmin)
    let planData = null;
    if (user.role !== "superadmin") {
      planData = await setupInitialPlan(user);

      // Handle referral credits if user was referred
      if (user.referredBy) {
        // Add $10 referral credits to the current user's cache (will be applied to Stripe on first purchase)
        try {
          user.cache_credits = (user.cache_credits || 0) + 10;
          console.log(
            `Added $10 welcome credit to user cache for user ${user._id}`
          );
        } catch (error) {
          console.error("Error adding welcome credit to user cache:", error);
        }

        // Add $10 referral credits to the referring user
        try {
          const referringUser = await User.findById(user.referredBy);
          if (referringUser) {
            // Check if referring user has made their first purchase
            let hasFirstPurchase = false;
            if (referringUser.stripeCustomerId) {
              hasFirstPurchase = await hasUserMadeFirstPurchase(
                referringUser.stripeCustomerId
              );
            }

            if (hasFirstPurchase) {
              // Add directly to Stripe customer account
              const referrerCustomer = await getOrCreateStripeCustomer(
                referringUser
              );
              await addStripeCredits(
                referrerCustomer.id,
                1000, // $10 in cents
                `Referral bonus - ${user.firstname || "User"
                } verified phone number`
              );
              console.log(
                `Added $10 referral credit directly to Stripe for referring user ${user.referredBy}`
              );
            } else {
              // Add to cache_credits
              referringUser.cache_credits =
                (referringUser.cache_credits || 0) + 10;
              await referringUser.save();
              console.log(
                `Added $10 referral credit to referring user cache ${user.referredBy}`
              );
            }
          }
        } catch (error) {
          console.error(
            "Error adding referral credits to referring user:",
            error
          );
        }
      }
    }

    const token = createTokenforUser(user);
    const referUrl = `https://demo.contacts.management/register?ref=${user.referralCode}`;

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
      phonenumber = "",
      countryCode = "",
      password = "",
      googleToken,
      appleToken,
      apiType = "mobile",
    } = req.body;

    if ((email || phonenumber) && password && !googleToken && !appleToken) {
      try {
        const trimmedEmail = email?.trim()?.toLowerCase();

        // raw inputs
        const rawPhoneInput = phonenumber || "";
        const rawCountryInput = countryCode || "";
        // const apiType = apiType || "mobile";

        // Normalize phone using helper (handles "917046658651", "+9170466...", separate cc+num, etc.)
        const { countryCode: normCountry, number: normNumber } = normalizePhone(
          {
            phonenumber: rawPhoneInput,
            countryCode: rawCountryInput,
            apiType,
          }
        );

        // Build query conditions
        const queryConditions = [];
        if (trimmedEmail) queryConditions.push({ email: trimmedEmail });

        if (normNumber && normCountry) {
          // we have both number and country
          queryConditions.push({
            phonenumbers: {
              $elemMatch: { number: normNumber, countryCode: normCountry },
            },
          });
        } else if (normNumber) {
          // only number parsed — try to match by stored number or legacy string
          queryConditions.push({
            $or: [
              { "phonenumbers.number": normNumber },
              { phonenumbers: normNumber }, // legacy array-of-strings case
            ],
          });
        }

        if (queryConditions.length === 0) {
          return res.status(400).json({
            status: "error",
            message: "Email or phone number is required",
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

        // If logging in by phone AND we have both country & number, require OTP verification completed
        if (normNumber && normCountry && !user.isVerified) {
          return res.status(403).json({
            status: "error",
            message: "Please complete signup and verify OTP first",
          });
        }

        // Prevent wrong login method
        if (user.signupMethod === "google") {
          return res.status(400).json({
            status: "error",
            message:
              "This user signed up with Google. Please use Google login.",
          });
        }
        if (user.signupMethod === "linkedin") {
          return res.status(400).json({
            status: "error",
            message:
              "This user signed up with linkedin. Please use linkedin login.",
          });
        }
        if (user.signupMethod === "apple") {
          return res.status(400).json({
            status: "error",
            message: "This user signed up with Apple. Please use Apple login.",
          });
        }

        if (user.signupMethod === "phoneNumber" && trimmedEmail) {
          return res.status(400).json({
            status: "error",
            message:
              "This user signed up with phone number. Please login with phone number and password.",
          });
        }

        if (user.signupMethod === "email" && (normNumber || rawPhoneInput)) {
          return res.status(400).json({
            status: "error",
            message:
              "This user signed up with email. Please login with email and password.",
          });
        }

        // Generate token (pass normalized phone fields)
        const token = await User.matchPasswordAndGenerateToken({
          email: trimmedEmail,
          phonenumber: normNumber,
          countryCode: normCountry,
          password,
        });
        // const customer = await getOrCreateStripeCustomer(user);
        console.log("set up initial plan for user during login:");

        const now = new Date();
        const isTrialActive = user.trialEnd && now < user.trialEnd;
        user.isActive = true; // mark as active
        return res.json({
          status: "success",
          message: "Login successful",
          data: {
            token,
            isTrialActive,
            trialEndsAt: user.trialEnd,
            registeredWith: user.signupMethod,
            role: user.role || "user",
          },
        });
      } catch (err) {
        return res.status(401).json({
          status: "error",
          message: err.message || "Invalid credentials",
        });
      }
    }

    // === GOOGLE LOGIN ===
    if (googleToken && !email && !password && !appleToken && !phonenumber) {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: googleToken,
          // audience: "308171825690-9tdne4lk5cof1rcmosck65i5iij46bvh.apps.googleusercontent.com",
          audience:
            "308171825690-ukpu99fsh0jsojolv0j4vrhidait4s5b.apps.googleusercontent.com",
        });

        const { email } = ticket.getPayload();
        let user = await User.findOne({ email });
        let isFirstTime = false;

        if (!user) {
          isFirstTime = true;

          const referralCodeParam =
            req.body.referralCode || req.query.ref || "";
          let referredBy = null;

          if (referralCodeParam) {
            const referringUser = await User.findOne({
              referralCode: referralCodeParam,
            });

            if (!referringUser) {
              return res.status(400).json({
                status: "error",
                message: "Invalid referral code",
              });
            }

            const previouslyReferred = await User.findOne({
              email,
              $or: [
                { referredBy: referringUser._id },
                { referralCode: referralCodeParam },
              ],
            });

            if (previouslyReferred) {
              return res.status(400).json({
                status: "error",
                message:
                  "This referral link has already been used with this email. Please sign up manually.",
              });
            }

            referredBy = referringUser._id;
          }

          const serialNumber = await User.getNextSerialNumber();
          const firstname = ticket.getPayload().given_name || "Google";
          const lastname = ticket.getPayload().family_name || "User";
          // const { qrCode } = await generateUserQRCode(firstname, serialNumber, {
          //   firstname,
          //   lastname,
          //   email,
          //   provider: "google"
          // });

          const now = new Date();
          const trialEnds = new Date(now);
          trialEnds.setDate(trialEnds.getDate() + 14); // Set 14-day trial

          const referralCodeRaw = email + Date.now();
          const referralCode = crypto
            .createHash("sha256")
            .update(referralCodeRaw)
            .digest("hex")
            .slice(0, 16);

          user = await User.create({
            email,
            firstname,
            lastname,
            provider: "google",
            serialNumber,
            // qrCode,
            signupMethod: "google",
            isVerified: true,
            trialStart: now,
            trialEnd: trialEnds,
            referralCode, // ✅ Store generated referral code
            referredBy, // ✅ Store who referred this user
          });

          // ✅ Add new user to referring user’s myReferrals
          if (referredBy) {
            const referrer = await User.findById(referredBy);
            if (referrer) {
              referrer.myReferrals.push({
                _id: user._id,
                firstname: user.firstname,
                lastname: user.lastname,
                email: user.email,
                phonenumbers: user.phonenumbers || [],
                signupDate: new Date(),
              });

              // Add credits to referrer using Stripe billing credits
              try {
                const referrerCustomer = await getOrCreateStripeCustomer(
                  referrer
                );
                await addStripeCredits(
                  referrerCustomer.id,
                  1000,
                  "Referral bonus - phone verification"
                ); // $10 in cents
              } catch (error) {
                console.error(
                  "Error adding Stripe credits to referrer:",
                  error
                );
              }
              await referrer.save();
            }

            // Add credits to user using Stripe billing credits
            try {
              const userCustomer = await getOrCreateStripeCustomer(user);
              await addStripeCredits(
                userCustomer.id,
                1000,
                "Welcome bonus - phone verification"
              ); // $10 in cents
            } catch (error) {
              console.error("Error adding Stripe credits to user:", error);
            }
            await user.save();
          }
        }

        const token = createTokenforUser(user);
        const now = new Date();
        const isTrialActive = user.trialEnd && now < user.trialEnd;
        return res.json({
          status: "success",
          message: "Google login successful",
          data: {
            token: token,
            registeredWith: user.signupMethod,
            isFirstTime: isFirstTime,
            isTrialActive,
            trialEndsAt: user.trialEnd,
          },
        });
      } catch (err) {
        console.log(err);
        return res
          .status(500)
          .json({ status: "error", message: "Google login failed" });
      }
    }

    // === APPLE LOGIN ===
    if (appleToken && !email && !password && !googleToken && !phonenumber) {
      try {
        let id_token = appleToken;

        if (!id_token.includes(".")) {
          const decoded = Buffer.from(id_token, "base64").toString("utf8");
          if (!decoded.includes(".")) {
            return res
              .status(400)
              .json({ message: "Invalid Apple token format" });
          }
          id_token = decoded;
        }

        const appleUser = await appleSignin.verifyIdToken(id_token, {
          audience: "com.contactmanagement",
          ignoreExpiration: true,
        });

        const appleEmail = appleUser.email || "noemail@apple.com";
        let user = await User.findOne({ email: appleEmail });

        // if (!user) {
        //   user = await User.create({
        //     email: appleEmail,
        //     provider: "apple",
        //     firstname: appleUser.firstName || "Apple",
        //     lastname: appleUser.lastName || "User",
        //   });
        // }

        // if (!user) {
        //   const serialNumber = await getNextSerialNumber();
        //   user = await User.create({
        //     email: appleEmail,
        //     provider: "apple",
        //     firstname: appleUser.firstName || "Apple",
        //     lastname: appleUser.lastName || "User",
        //     serialNumber
        //   });
        // }

        if (!user) {
          const serialNumber = await User.getNextSerialNumber();
          const firstname = appleUser.firstName || "Apple";
          const lastname = appleUser.lastName || "User";

          // const { qrCode } = await generateUserQRCode(firstname, serialNumber, {
          //   firstname,
          //   lastname,
          //   email: appleEmail,
          //   provider: "apple"
          // });

          const now = new Date();
          const trialEnds = new Date(now);
          trialEnds.setDate(trialEnds.getDate() + 14); // Set 14-day trial

          user = await User.create({
            email: appleEmail,
            provider: "apple",
            firstname,
            lastname,
            serialNumber,
            // qrCode,
            signupMethod: "apple",
            trialStart: now,
            trialEnd: trialEnds,
          });
        }

        const token = createTokenforUser(user);
        const now = new Date();
        const isTrialActive = user.trialEnd && now < user.trialEnd;
        return res.json({
          status: "success",
          message: "Apple login successful",
          data: {
            token,
            isTrialActive,
            trialEndsAt: user.trialEnd,
          },
        });
      } catch (err) {
        return res
          .status(500)
          .json({ status: "error", message: "Apple login failed" });
      }
    }

    return res
      .status(400)
      .json({ status: "error", message: "Invalid login request" });
  } catch (err) {
    return res.status(500).json({ status: "error", message: "Login failed" });
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
};
