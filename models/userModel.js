const { createHmac, randomBytes } = require("crypto");
const { Schema, model, mongoose } = require("mongoose");
const { createTokenforUser } = require("../services/authentication");

const userSchema = new Schema(
  {

    // serialNumber: {
    //   type: String,
    //   unique: true,
    //   required: true,
    //   default: "", // Avoids null
    // },

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


    emailVerificationToken: String,
    isVerified: {
      type: Boolean,
      default: false,
    },

    signupMethod: {
      type: String,
      enum: ["email", "phoneNumber", "google", "apple", "linkedin"],
      default: "email", // or leave unset until signup
    },

    role: {
      type: String,
      enum: ["user", "superadmin"],
      default: "user",
    },

    trialStart: { type: Date },
    trialEnd: { type: Date },

    isActive: {
      type: Boolean,
      default: false, // user is inactive until login
    },

    lastSeen: { type: Date, default: null },


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

    otp: { type: String },
    otpExpiresAt: { type: Date },

    salt: {
      type: String,
      // required: true,
    },
    password: {
      type: String,
      required: function () {
        // Only require password for local users
        return !this.provider || this.provider === "local";
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

// userSchema.post("save", async function (doc, next) {
//   try {
//     const existingDefault = await Contact.findOne({
//       createdBy: doc._id,
//       firstname: { $regex: /^california$/i },
//       lastname: { $regex: /^media$/i },
//     });

//     const _id = new mongoose.Types.ObjectId();

//     if (!existingDefault) {
//       await Contact.create({
//         _id,
//         contact_id: _id,
//         firstname: "California",
//         lastname: "Media",
//         emailaddresses: ["web@californiamediauae.com"],
//         // phonenumbers: ["971 50 875 8109"],
//         linkedin: "https://linkedin.com/company/californiamedia",
//         instagram: "https://instagram.com/californiamedia",
//         telegram: "https://t.me/californiamedia",
//         twitter: "https://twitter.com/californiamedia",
//         facebook: "https://facebook.com/californiamedia",
//         // contactImageURL: "https://example.com/default-contact.jpg",
//         isFavourite: true,
//         // tags: [
//         //   {
//         //     tag_id: new mongoose.Types.ObjectId(),
//         //     tag: "Default",
//         //     emoji: "⭐"
//         //   }
//         // ],
//         activities: [
//           {
//             action: "contact_created",
//             type: "contact",
//             title: "Default Contact",
//             description: "Default contact created automatically",
//             timestamp: new Date(),
//           },
//         ],
//         createdBy: doc._id,
//       });
//     }

//     next();
//   } catch (err) {
//     console.error("Failed to insert default contact:", err);
//     next(err);
//   }
// });

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

// userSchema.statics.getNextSerialNumber = async function () {
//   const result = await Counter.findByIdAndUpdate(
//     { _id: "serial_counter_user" },
//     { $inc: { serialCounter: 1 } },
//     {
//       new: true,
//       upsert: true,
//     }
//   );

//   console.log("🔍 Counter update result:", result);

//   if (!result || typeof result.serialCounter !== "number") {
//     throw new Error("Failed to generate a new serial number");
//   }

//   return result.serialCounter.toString().padStart(1, "0");
// };

const User = model("User", userSchema);
module.exports = User;
