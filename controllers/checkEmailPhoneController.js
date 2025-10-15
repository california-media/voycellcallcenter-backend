// const User = require("../models/userModel");
// const mongoose = require("mongoose");
// const { parsePhoneNumberFromString } = require("libphonenumber-js");

// exports.checkEmailPhoneDuplicate = async (req, res) => {
//   try {
//     const { email, phonenumber, countryCode, user_id, apiType = "web" } = req.body;

//     if (!email && !phonenumber) {
//       return res.status(400).json({
//         status: "error",
//         message: "Please provide email or phone number for checking.",
//       });
//     }



//     const query = { $or: [] };

//     const trimmedEmail = email?.trim().toLowerCase();
//     let normalizedPhone = "";
//     let normalizedCountryCode = "";

//     if (email) {
//       query.$or.push({ email: trimmedEmail });
//     }

//     // ✅ Handle phone based on apiType
//     if (phonenumber) {
//       if (apiType === "web") {
//         // For web → number contains full phone with country code
//         const phoneObj = parsePhoneNumberFromString(phonenumber);
//         if (phoneObj) {
//           normalizedPhone = phoneObj.nationalNumber; // only number part
//           normalizedCountryCode = phoneObj.countryCallingCode; // country code
//         }
//       } else if (apiType === "mobile") {
//         // For mobile → already separate
//         normalizedPhone = phonenumber.replace(/^\+/, "");
//         if (countryCode) {
//           normalizedCountryCode = countryCode.replace(/^\+/, "");
//         }
//       }
//     }
//     // if (countryCode) {
//     //   normalizedCountryCode = countryCode.replace(/^\+/, ""); // ✅ remove leading +
//     // }

//     // if (phonenumber && countryCode) {
//     //   query.$or.push({
//     //     phonenumbers: {
//     //       $elemMatch: {
//     //         countryCode: normalizedCountryCode,
//     //         number: normalizedPhone,
//     //       },
//     //     },
//     //   });
//     // }

//     if (phonenumber && normalizedCountryCode) {
//       query.$or.push({
//         phonenumbers: {
//           $elemMatch: {
//             countryCode: normalizedCountryCode,
//             number: normalizedPhone,
//           },
//         },
//       });
//     }


//     // ✅ Exclude current user (if editing)
//     if (user_id && mongoose.Types.ObjectId.isValid(user_id)) {
//       query._id = { $ne: user_id };
//     }

//     const existingUsers = await User.find(query, "email phonenumbers");

//     let emailUsed = false;
//     let phoneUsed = false;

//     for (const user of existingUsers) {
//       if (email && user.email?.toLowerCase() === trimmedEmail) {
//         emailUsed = true;
//       }

//       // if (
//       //   phonenumber &&
//       //   countryCode &&
//       //   user.phonenumbers.some(
//       //     (p) =>
//       //       p.countryCode === normalizedCountryCode &&
//       //       p.number === normalizedPhone
//       //   )
//       // ) 
//       if (
//         phonenumber &&
//         normalizedCountryCode &&
//         user.phonenumbers.some(
//           (p) =>
//             p.countryCode === normalizedCountryCode &&
//             p.number === normalizedPhone
//         )
//       ) {
//         phoneUsed = true;
//       }
//     }

//     // ✅ Duplicate Error Messages
//     if (emailUsed || phoneUsed) {
//       let errorMessage = "";

//       if (emailUsed && phoneUsed) {
//         errorMessage =
//           "Both email and phone number are already used by another user.";
//       } else if (emailUsed) {
//         errorMessage = "Email is already used by another user.";
//       } else if (phoneUsed) {
//         errorMessage = "Phone number is already used by another user.";
//       }

//       return res.status(400).json({
//         status: "error",
//         message: errorMessage,
//       });
//     }

//     // ✅ Success Messages
//     let successMessage = "";

//     if (email && phonenumber) {
//       successMessage = "Both email and phone number are available.";
//     } else if (email) {
//       successMessage = "Email is available.";
//     } else if (phonenumber) {
//       successMessage = "Phone number is available.";
//     }

//     return res.status(200).json({
//       status: "success",
//       message: successMessage,
//     });
//   } catch (error) {
//     console.error("Duplicate check error:", error);
//     return res.status(500).json({
//       status: "error",
//       message: "Internal server error during duplicate check.",
//     });
//   }
// };

const User = require("../models/userModel");
const mongoose = require("mongoose");
const { parsePhoneNumberFromString } = require("libphonenumber-js");

exports.checkEmailPhoneDuplicate = async (req, res) => {
  try {
    const { email, phonenumber, countryCode, user_id, apiType = "web" } = req.body;

    if (!email && !phonenumber) {
      return res.status(400).json({
        status: "error",
        message: "Please provide email or phone number for checking.",
      });
    }

    const query = { $or: [] };

    const trimmedEmail = email?.trim().toLowerCase();
    let normalizedPhone = "";
    let normalizedCountryCode = "";

    if (email) {
      query.$or.push({ email: trimmedEmail });
    }

    // ✅ Normalize phone for both web and mobile
    if (phonenumber) {
      if (apiType === "web") {
        // Expect phonenumber like +917046658651 or 917046658651
        const phoneObj = parsePhoneNumberFromString(phonenumber.startsWith("+") ? phonenumber : "+" + phonenumber);
        if (phoneObj) {
          normalizedPhone = phoneObj.nationalNumber;        // "7046658651"
          normalizedCountryCode = phoneObj.countryCallingCode; // "91"
        }
      } else if (apiType === "mobile") {
        // Mobile → already separate
        normalizedPhone = phonenumber.replace(/^\+/, "");   // "7046658651"
        if (countryCode) {
          normalizedCountryCode = countryCode.replace(/^\+/, ""); // "91"
        }
      }
    }

    // ✅ Only push to query if we have normalized values
    if (normalizedPhone && normalizedCountryCode) {
      query.$or.push({
        phonenumbers: {
          $elemMatch: {
            countryCode: normalizedCountryCode,
            number: normalizedPhone,
          },
        },
      });
    }

    // ✅ Exclude current user (if editing)
    if (user_id && mongoose.Types.ObjectId.isValid(user_id)) {
      query._id = { $ne: user_id };
    }

    const existingUsers = await User.find(query, "email phonenumbers");

    let emailUsed = false;
    let phoneUsed = false;

    for (const user of existingUsers) {
      if (email && user.email?.toLowerCase() === trimmedEmail) {
        emailUsed = true;
      }

      if (
        normalizedPhone &&
        normalizedCountryCode &&
        user.phonenumbers.some(
          (p) =>
            p.countryCode === normalizedCountryCode &&
            p.number === normalizedPhone
        )
      ) {
        phoneUsed = true;
      }
    }

    // ✅ Duplicate Error Messages
    if (emailUsed || phoneUsed) {
      let errorMessage = "";

      if (emailUsed && phoneUsed) {
        errorMessage = "Both email and phone number are already used by another user.";
      } else if (emailUsed) {
        errorMessage = "Email is already used by another user.";
      } else if (phoneUsed) {
        errorMessage = "Phone number is already used by another user.";
      }

      return res.status(400).json({
        status: "error",
        message: errorMessage,
      });
    }

    // ✅ Success Messages
    let successMessage = "";

    if (email && phonenumber) {
      successMessage = "Both email and phone number are available.";
    } else if (email) {
      successMessage = "Email is available.";
    } else if (phonenumber) {
      successMessage = "Phone number is available.";
    }

    return res.status(200).json({
      status: "success",
      message: successMessage,
    });
  } catch (error) {
    console.error("Duplicate check error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error during duplicate check.",
    });
  }
};


