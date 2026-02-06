const { createHmac, randomBytes } = require("crypto");
const { Schema, model, mongoose } = require("mongoose");
const { createTokenforUser } = require("../services/authentication");

const whatsappTemplateSchema = new Schema(
  {
    whatsappTemplate_id: {
      type: mongoose.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
    },
    whatsappTemplateTitle: String,
    whatsappTemplateMessage: String,
    whatsappTemplateIsFavourite: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    _id: false,
  }
);

const emailTemplateSchema = new Schema(
  {
    emailTemplate_id: {
      type: mongoose.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
    },
    emailTemplateTitle: String,
    emailTemplateSubject: String,
    emailTemplateBody: String,
    emailTemplateIsFavourite: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    _id: false,
  }
);

const userSchema = new Schema(
  {
    firstname: {
      type: String,
      // default: "Dummy Firstname",
    },
    lastname: {
      type: String,
      // default: "Dummy Lastname",
    },

    gender: {
      type: String,
      // default: "Dummy Lastname",
    },

    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      // default: null, // ✅ makes sure null is used instead of ""
    },

    tags: [
      {
        _id: false,
        tag_id: {
          type: mongoose.Schema.Types.ObjectId,
          default: () => new mongoose.Types.ObjectId(),
        },
        tag: {
          type: String,
          default: "VoyCell",
        },
        emoji: {
          type: String, // URL to S3
          default: "🏷️",
        },
        order: {
          type: Number, // New field
        },
      },
    ],

    whatsappTemplates: {
      type: [whatsappTemplateSchema],
      default: () => [
        {
          whatsappTemplate_id: new mongoose.Types.ObjectId(),
          whatsappTemplateTitle: "Welcome Message",
          whatsappTemplateMessage:
            "Hey {{firstname}}! 👋 Welcome to our platform. Let me know if you need any help getting started.",
          whatsappTemplateIsFavourite: true,
        },
        {
          whatsappTemplate_id: new mongoose.Types.ObjectId(),
          whatsappTemplateTitle: "Follow-up",
          whatsappTemplateMessage:
            "Hi {{firstname}}, just checking in to see if you had a chance to review our last conversation.",
          whatsappTemplateIsFavourite: false,
        },
        {
          whatsappTemplate_id: new mongoose.Types.ObjectId(),
          whatsappTemplateTitle: "Meeting Reminder",
          whatsappTemplateMessage:
            "Reminder: Your meeting with us is scheduled. Let us know if you need to reschedule.",
          whatsappTemplateIsFavourite: false,
        },
        {
          whatsappTemplate_id: new mongoose.Types.ObjectId(),
          whatsappTemplateTitle: "Thank You",
          whatsappTemplateMessage:
            "Thanks a lot for your time today, {{firstname}}! 😊 Looking forward to staying in touch.",
          whatsappTemplateIsFavourite: true,
        },
        {
          whatsappTemplate_id: new mongoose.Types.ObjectId(),
          whatsappTemplateTitle: "Support Offer",
          whatsappTemplateMessage:
            "Hi {{firstname}}, if you have any questions or need assistance, feel free to reply to this message. We're here to help! 🙌",
          whatsappTemplateIsFavourite: false,
        },
      ],
    },

    emailTemplates: {
      type: [emailTemplateSchema],
      default: () => [
        {
          emailTemplate_id: new mongoose.Types.ObjectId(),
          emailTemplateTitle: "Welcome Email",
          emailTemplateSubject: "Welcome to Our Platform!",
          emailTemplateBody:
            "Hi {{firstname}},\n\nThank you for joining us! We're excited to have you on board.\n\nBest,\nTeam",
          emailTemplateIsFavourite: true,
        },
        {
          emailTemplate_id: new mongoose.Types.ObjectId(),
          emailTemplateTitle: "Follow-up Email",
          emailTemplateSubject: "Just checking in",
          emailTemplateBody:
            "Hi {{firstname}},\n\nI wanted to follow up on our last conversation. Let me know if you have any questions.\n\nRegards,\n{{senderName}}",
          emailTemplateIsFavourite: false,
        },
        {
          emailTemplate_id: new mongoose.Types.ObjectId(),
          emailTemplateTitle: "Meeting Reminder",
          emailTemplateSubject: "Upcoming Meeting Reminder",
          emailTemplateBody:
            "Hi {{firstname}},\n\nThis is a quick reminder for our meeting.\n\nThanks,\n{{senderName}}",
          emailTemplateIsFavourite: false,
        },
        {
          emailTemplate_id: new mongoose.Types.ObjectId(),
          emailTemplateTitle: "Thank You Email",
          emailTemplateSubject: "Thank You!",
          emailTemplateBody:
            "Hi {{firstname}},\n\nJust wanted to thank you for your time today. Looking forward to our next steps.\n\nCheers,\n{{senderName}}",
          emailTemplateIsFavourite: true,
        },
        {
          emailTemplate_id: new mongoose.Types.ObjectId(),
          emailTemplateTitle: "Feedback Request",
          emailTemplateSubject: "We'd love your feedback!",
          emailTemplateBody:
            "Hi {{firstname}},\n\nWe hope you're enjoying our service. We'd appreciate it if you could share your thoughts or suggestions.\n\nWarm regards,\nTeam",
          emailTemplateIsFavourite: false,
        },
      ],
    },

    emailVerificationToken: String,
    pendingEmailChange: {
      newEmail: String,
      token: String,
      createdAt: Date,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },

    signupMethod: {
      type: String,
      enum: ["email", "phoneNumber", "google", "apple", "linkedin"],
      default: "email", // or leave unset until signup
    },

    // 🔐 Login protection
    failedLoginAttempts: {
      type: Number,
      default: 0,
    },

    firstFailedLoginAt: {
      type: Date,
      default: null,
    },

    lockUntil: {
      type: Date,
      default: null,
    },

    agentStatus: {
      type: String,
      enum: ["offline", "online", "busy"],
      default: "offline",
    },

    currentCallId: {
      type: String,
      default: null,
    },

    activeSessionId: {
      type: String,
      default: null,
    },

    magicLoginToken: {
      type: String,
      default: null,
    },

    magicLoginExpires: {
      type: Date,
      default: null,
    },

    role: {
      type: String,
      enum: ["user", "companyAdmin", "superadmin"], /// user here is calling agent, not modifying to prevent breaking stuff
      default: "user",
    },

    createdByWhichCompanyAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "companyAdmin", // reference to the company admin user who created this user
      default: null,
    },

    trialStart: { type: Date },
    trialEnd: { type: Date },

    isActive: {
      type: Boolean,
      default: false, // user is inactive until login
    },

    accountStatus: {
      type: String,
      enum: ["active", "deactivated", "suspended"],
      default: "active",
    },

    lastSeen: { type: Date, default: null },

    extensionStatus: {
      type: Boolean,
      default: false,
    },

    // SUPER ADMIN → Device Level
    // 🔹 Multiple PBX Devices — Super Admin Only
    yeastarDevices: [
      {
        deviceId: {
          type: mongoose.Schema.Types.ObjectId,
          default: () => new mongoose.Types.ObjectId(),
        },

        deviceName: String, // e.g. Head Office PBX

        PBX_BASE_URL: String,
        PBX_USERNAME: String,
        PBX_PASSWORD: String,
        PBX_SDK_ACCESS_ID: String,
        PBX_SDK_ACCESS_KEY: String,
        PBX_USER_AGENT: String,

        isActive: {
          type: Boolean,
          default: true,
        },

        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    yeastarDetails: {
      PBX_BASE_URL: String,
      PBX_USERNAME: String,
      PBX_PASSWORD: String,
      PBX_SDK_ACCESS_ID: String,
      PBX_SDK_ACCESS_KEY: String,
      PBX_USER_AGENT: String,
      PBX_EXTENSION_NUMBER: String,
      PBX_EXTENSION_ID: String,
      PBX_SIP_SECRET: String,
      PBX_TELEPHONE: String,
      assignedDeviceId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
    },

    userInfo: {
      helps: {
        type: [String],
        default: [],
      },
      goals: {
        type: String,
        default: "",
      },
      categories: {
        type: String,
        default: "",
      },
      employeeCount: {
        type: String,
        default: "",
      },
      companyName: {
        type: String,
        default: "",
      },
    },

    popupSettings: {
      themeColor: { type: String, default: "#4CAF50" },
      popupHeading: { type: String, default: "📞 Request a Call Back" },
      headingColor: { type: String, default: "#4CAF50" },
      floatingButtonColor: { type: String, default: "#4CAF50" },
      popupText: {
        type: String,
        default:
          "Enter your phone number and we'll call you back in 30 seconds!",
      },
      calltoaction: { type: String, default: "📞 Call Me" },
      phoneIconColor: { type: String, default: "black" }, // 'black' or 'white'
      // Add this near popupSettings in userSchema
      allowedOriginPopup: {
        type: [String], // ✅ multiple origins
        default: [],
      },
      allowedOriginContactForm: {
        type: [String], // ✅ multiple origins
        default: [],
      },
      restrictedUrls: {
        type: [String], // ✅ multiple URLs
        default: [],
      },
      fieldName: { type: String, default: "phone" },
    },

    extensionNumber: { type: String, default: null },
    yeastarExtensionId: { type: String, default: null }, // whatever PBX returns as id
    sipSecret: { type: String, default: null }, // store the extension secret if needed
    yeastarProvisionStatus: { type: String, default: "pending" }, // 'pending' | 'done' | 'failed'
    yeastarProvisionError: { type: String, default: "" },

    phonenumbers: [
      {
        countryCode: {
          type: String,
        },
        number: {
          type: String,
        },
        _id: false, // Use the number as the unique identifier
      },
    ],

    telephone: {
      type: String,
      default: "",
      trim: true,
    },

    otp: { type: String },
    otpExpiresAt: { type: Date },

    salt: {
      type: String,
      // required: true,
    },

    googleId: { type: String }, // ✅ Store Google user ID as String
    googleEmail: String,
    googleAccessToken: String,
    googleRefreshToken: String,
    googleConnected: {
      type: Boolean,
      default: false,
    },

    zoom: {
      isConnected: { type: Boolean, default: false },
      accountId: String,
      userId: String,
      email: String,

      accessToken: String,
      refreshToken: String,
      tokenExpiresAt: Date,
    },

    // whatsappWaba: {
    //   isConnected: { type: Boolean, default: false },
    //   wabaId: String,
    //   phoneNumberId: String,
    //   businessAccountId: String,
    //   accessToken: String,
    //   phoneNumber: String,

    //   templates: [
    //     {
    //       templateId: String,        // Meta template ID
    //       name: String,
    //       category: String,          // MARKETING, UTILITY
    //       language: String,          // en_US
    //       status: String,            // APPROVED, PENDING
    //       components: Array
    //     }
    //   ]
    // },

    whatsappWaba: {
      isConnected: { type: Boolean, default: false },

      wabaId: String,
      phoneNumberId: String,
      businessAccountId: String,

      accessToken: String,
      tokenExpiresAt: Date,

      phoneNumber: String,
      displayName: String,
      qualityRating: Object,
      messagingLimit: String,
      businessVerificationStatus: String,
      accountReviewStatus: String,
      status: String,

      profile: {
        displayName: String,
        messageLimit: String,
        about: String,
        address: String,
        description: String,
        email: String,
        vertical: String,
        websites: [String],
        profilePictureUrl: String,
        profilePictureS3Url: String
      },

      webhook: {
        callbackUrl: String,
        verifyToken: String
      }
    },

    microsoftId: { type: String }, // ✅ Store Microsoft ID as String (not ObjectId)
    microsoftEmail: String,
    microsoftAccessToken: String,
    microsoftConnected: { type: Boolean, default: false },

    smtpId: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
    }, // SMTP ID can stay ObjectId
    smtpHost: { type: String },
    smtpPort: { type: Number },
    smtpUser: { type: String },
    smtpPass: { type: String },
    smtpSecure: { type: Boolean, default: true },
    smtpConnected: { type: Boolean, default: false },

    pipedrive: {
      isConnected: { type: Boolean, default: false },
      userId: String,
      companyId: Number,
      accessToken: String,
      refreshToken: String,
      tokenExpiresAt: Date
    },




    // zohoId: { type: String },
    // zohoEmail: { type: String },
    // zohoAccessToken: { type: String },
    // zohoRefreshToken: { type: String },
    // zohoConnected: { type: Boolean, default: false },

    meta: {
      isConnected: { type: Boolean, default: false },

      facebookUserId: { type: String },     // Meta user id
      accessToken: { type: String },        // short-lived
      longLivedToken: { type: String },     // long-lived
      tokenExpiresAt: { type: Date },

      adAccounts: [
        {
          adAccountId: String,
          name: String,
          currency: String
        }
      ],

      selectedAdAccountId: String,

      leadForms: [
        {
          formId: String,
          formName: String,
          pageId: String,
          pageName: String
        }
      ],

      selectedFormId: String,

      // Pages subscribed to receive webhook events
      subscribedPages: [
        {
          pageId: String,
          pageName: String,
          pageAccessToken: String,
          subscribedAt: { type: Date, default: Date.now }
        }
      ]
    },


    zoho: {
      isConnected: { type: Boolean, default: false },
      dc: { type: String },              // in | com | eu | au
      accountsUrl: { type: String },
      apiBaseUrl: { type: String },
      accessToken: { type: String },
      refreshToken: { type: String },
      userId: { type: String },      // ✅ REQUIRED
      timezone: { type: String },     // ✅ REQUIRED
    },



    password: {
      type: String,
      required: function () {
        // ✅ Only require password if the user is completing signup, not being added by admin
        return this.isVerified && (!this.provider || this.provider === "local");
      },
    },

    linkedin: {
      type: String,
      // default: "Dummy Firstname",
    },
    instagram: {
      type: String,
      // default: "Dummy Firstname",
    },
    telegram: {
      type: String,
      // default: "Dummy Firstname",
    },
    twitter: {
      type: String,
      // default: "Dummy Firstname",
    },
    facebook: {
      type: String,
      // default: "Dummy Firstname",
    },
    designation: {
      type: String,
      // default: "Dummy Firstname",
    },

    profileImageURL: {
      type: String,
    },

    referralCode: {
      type: String,
      unique: true,
      sparse: true,
    },

    referredBy: {
      /////user id of user who referred this user
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    myReferrals: {
      type: [
        new mongoose.Schema(
          {
            _id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            firstname: { type: String, default: "" },
            lastname: { type: String, default: "" },
            email: { type: String, default: "" },
            phonenumbers: [
              {
                countryCode: { type: String, default: "" },
                number: { type: String, default: "" },
                _id: false,
              },
            ],
            signupDate: { type: Date, default: null },
          },
          { _id: false }
        ), // avoid auto subdoc _id (we keep the _id field for referred user)
      ],
      default: [],
    },

    // Cache for referral credits before they're applied to Stripe
    cache_credits: {
      type: Number,
      default: 0,
    },

    // Contact Statuses for this user/company
    contactStatuses: {
      type: [
        {
          _id: false,
          value: {
            type: String,
            required: true,
            trim: true,
          },
          label: {
            type: String,
            required: true,
            trim: true,
          },
        },
      ],
      default: [
        { value: "interested", label: "Interested" },
        { value: "notInterested", label: "Not Interested" },
        { value: "called", label: "Called" },
        { value: "notValid", label: "Not Valid" },
        { value: "contacted", label: "Contacted" },
        { value: "win", label: "Win" },
        { value: "lost", label: "Lost" },
        { value: "noAnswer", label: "No Answer" },
      ],
    },

    // Lead Statuses for this user/company
    leadStatuses: {
      type: [
        {
          _id: false,
          value: {
            type: String,
            required: true,
            trim: true,
          },
          label: {
            type: String,
            required: true,
            trim: true,
          },
          group: {
            type: Number,
            required: true,
          },
          isDefault: {
            type: Boolean,
            default: false,
          },
        },
      ],
      default: [
        { value: "interested", label: "Interested", group: 1, isDefault: true },
        { value: "followup", label: "Follow Up", group: 2, isDefault: true },
        { value: "win", label: "Win", group: 3, isDefault: true },
        { value: "lost", label: "Lost", group: 3, isDefault: false },
        { value: "callBack", label: "Call Back", group: 4, isDefault: false },
        { value: "noAnswer", label: "No Answer", group: 4, isDefault: false },
        {
          value: "callSuccess",
          label: "Call Success",
          group: 5,
          isDefault: true,
        },
      ],
    },

    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
  },
  { timestamps: true }
);

userSchema.pre("save", function (next) {
  const user = this;
  // 🛑 Assign serial number if not already set
  // if (!user.serialNumber) {
  //   user.serialNumber = await this.constructor.getNextSerialNumber();
  // }
  if (!user.isModified("password")) return next();

  const salt = randomBytes(16).toString();
  const hashPassword = createHmac("sha256", salt)
    .update(user.password)
    .digest("hex");

  this.salt = salt;
  this.password = hashPassword;
  next();
});

userSchema.static(
  "matchPasswordAndGenerateToken",
  async function ({ email, phonenumber, countryCode, password }) {
    if (!password || (!email && !phonenumber)) {
      throw new Error("Email or phone number and password are required");
    }

    const query = email
      ? { email }
      : // : { phonenumbers: { $in: [phonenumber] } }; // assuming you store phone numbers as array
      { phonenumbers: { $elemMatch: { countryCode, number: phonenumber } } };

    const user = await this.findOne(query);
    if (!user) throw new Error("User not found");

    const hash = createHmac("sha256", user.salt).update(password).digest("hex");
    if (hash !== user.password) throw new Error("Password not matched");

    return createTokenforUser(user);
  }
);

const User = model("User", userSchema);
module.exports = User;
