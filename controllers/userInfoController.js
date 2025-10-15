const User = require("../models/userModel");
const { parsePhoneNumberFromString } = require("libphonenumber-js");


exports.getDefaultOptions = (req, res) => {
  try {
    const defaultOptions = {
      helps: [
        "Managing Sales pipelines",
        "Organizing key relationships",
        "Process automation",
        "Something else"
      ],
      goals: [
        "For personal use",
        "Testing for my company/team",
        "Other"
      ],
      categories: [
        "Sales", "Marketing", "IT", "Procurement", "Consultant",
        "C-Level", "HR", "Field Representative", "Freelancer", "Other"
      ],
      employeeCounts: [
        "1-4", "5-19", "20-49", "50-99", "100-249",
        "250-499", "500-999", "1000+"
      ]
    };

    res.status(200).json({ status: "success", defaultOptions });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
};

// exports.submitUserOnboarding = async (req, res) => {
//   try {
//     const {
//       helps = [],
//       goals = [],
//       categories = [],
//       employeeCount = "",
//       companyName = "",
//       isFirstCRM = false
//     } = req.body;

//     const user = await User.findById(req.user._id);
//     if (!user) {
//       return res.status(404).json({ status: "error", message: "User not found" });
//     }

//     // Ensure userInfo object exists
//     if (!user.userInfo) user.userInfo = {};

//     user.userInfo.helps = helps;
//     user.userInfo.goals = goals;
//     user.userInfo.categories = categories;
//     user.userInfo.employeeCount = employeeCount;
//     user.userInfo.companyName = companyName;
//     user.userInfo.isFirstCRM = isFirstCRM;

//     await user.save();

//     res.status(200).json({
//       status: "success",
//       message: "User onboarding data saved",
//       userInfo: user.userInfo
//     });
//   } catch (error) {
//     console.error("Onboarding error:", error);
//     res.status(500).json({
//       status: "error",
//       message: "Failed to save onboarding data",
//       error: error.message
//     });
//   }
// };


// exports.submitUserOnboarding = async (req, res) => {
//   try {
//     const {
//       helps = [],
//       goals = "",
//       categories = "",
//       employeeCount = "",
//       companyName = "",
//       firstname = "",
//       lastname = "",
//       gender = "",
//       email = "",
//       phonenumber = ""
//     } = req.body;

//     const user = await User.findById(req.user._id);
//     if (!user) {
//       return res.status(404).json({ status: "error", message: "User not found" });
//     }

//     // Conditionally update email or phonenumber
//     if (!user.email && email) {
//       user.email = email.trim();
//     }

//     if ((!user.phonenumbers || user.phonenumbers.length === 0) && phonenumber) {
//       const cleanedPhone = String(phonenumber).replace(/[^\d]/g, "");
//       if (cleanedPhone) {
//         user.phonenumbers = [cleanedPhone];
//       }
//     }

//     // Update basic fields
//     if (firstname) user.firstname = firstname;
//     if (lastname) user.lastname = lastname;
//     if (gender) user.gender = gender;

//     // Ensure userInfo object exists
//     if (!user.userInfo) user.userInfo = {};

//     user.userInfo.helps = helps;
//     user.userInfo.goals = goals;
//     user.userInfo.categories = categories;
//     user.userInfo.employeeCount = employeeCount;
//     user.userInfo.companyName = companyName;

//     await user.save();

//     res.status(200).json({
//       status: "success",
//       message: "User onboarding data saved",
//       data: {
//         email: user.email,
//         phonenumbers: user.phonenumbers,
//         firstname: user.firstname,
//         lastname: user.lastname,
//         gender: user.gender,
//         userInfo: user.userInfo
//       }
//     });
//   } catch (error) {
//     console.error("Onboarding error:", error);
//     res.status(500).json({
//       status: "error",
//       message: "Failed to save onboarding data",
//       error: error.message
//     });
//   }
// };

exports.submitUserOnboarding = async (req, res) => {
  try {
    const {
      helps = [],
      goals = "",
      categories = "",
      employeeCount = "",
      companyName = "",
      firstname = "",
      lastname = "",
      gender = "",
      email = "",
      phonenumber = "",
      countryCode = "",
      designation = "",
      apiType = "web" // default mobile
    } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    if (email) {
      const existingEmailUser = await User.findOne({
        _id: { $ne: req.user._id },
        email: email.trim(),
      });
      if (existingEmailUser) {
        return res.status(400).json({
          status: "error",
          message: "Email is already used by another user",
        });
      }
    }

    // if (phonenumber) {
    //   const cleanedPhone = String(phonenumber).replace(/[^\d]/g, "");
    //   const existingPhoneUser = await User.findOne({
    //     _id: { $ne: req.user._id },
    //     phonenumbers: cleanedPhone,
    //   });
    //   if (existingPhoneUser) {
    //     return res.status(400).json({
    //       status: "error",
    //       message: "Phone number is already used by another user",
    //     });
    //   }
    // }

    // if (phonenumber && countryCode) {
    //   const cleanedPhone = String(phonenumber).replace(/[^\d]/g, "");
    //   const cleanedCode = String(countryCode).replace(/^\+/, "");

    //   const existingPhoneUser = await User.findOne({
    //     _id: { $ne: req.user._id },
    //     phonenumbers: {
    //       $elemMatch: {
    //         countryCode: cleanedCode,
    //         number: cleanedPhone,
    //       },
    //     },
    //   });

    //   if (existingPhoneUser) {
    //     return res.status(400).json({
    //       status: "error",
    //       message: "Phone number is already used by another user",
    //     });
    //   }
    // }

    let finalCountryCode = "";
    let finalPhoneNumber = "";

    if (phonenumber) {
      if (apiType === "mobile") {
        // Mobile flow (use provided countryCode)
        finalPhoneNumber = String(phonenumber).replace(/[^\d]/g, "");
        finalCountryCode = String(countryCode || "").replace(/^\+/, "");
      } else if (apiType === "web") {
        // Web flow (parse phone number)
        let inputPhone = phonenumber.startsWith("+") ? phonenumber : `+${phonenumber}`;
        const parsed = parsePhoneNumberFromString(inputPhone);
        if (!parsed) {
          return res.status(400).json({ status: "error", message: "Invalid phone number format" });
        }
        finalPhoneNumber = parsed.nationalNumber;
        finalCountryCode = parsed.countryCallingCode;
      }

      // ✅ Check for uniqueness in DB
      const existingPhoneUser = await User.findOne({
        _id: { $ne: req.user._id },
        phonenumbers: {
          $elemMatch: {
            countryCode: finalCountryCode,
            number: finalPhoneNumber,
          },
        },
      });

      if (existingPhoneUser) {
        return res.status(400).json({
          status: "error",
          message: "Phone number is already used by another user",
        });
      }
    }



    // ✅ If user signed up with phone number, but now also providing email, save it if not already saved
    if (!user.email && email) {
      user.email = email.trim();
    }

    // ✅ If user signed up with email, but now providing phonenumber, add it to phonenumbers array (prevent duplicate)
    // if (phonenumber) {
    //   const cleanedPhone = String(phonenumber).replace(/[^\d]/g, "");
    //   if (cleanedPhone) {
    //     if (!user.phonenumbers) user.phonenumbers = [];
    //     if (!user.phonenumbers.includes(cleanedPhone)) {
    //       user.phonenumbers.push(cleanedPhone);
    //     }
    //   }
    // }

    // if (phonenumber && countryCode) {
    //   const cleanedPhone = String(phonenumber).replace(/[^\d]/g, "");
    //   const cleanedCode = String(countryCode).replace(/^\+/, "");

    //   if (cleanedPhone) {
    //     if (!user.phonenumbers) user.phonenumbers = [];

    //     const alreadyExists = user.phonenumbers.some(
    //       p => p.countryCode === cleanedCode && p.number === cleanedPhone
    //     );

    //     if (!alreadyExists) {
    //       user.phonenumbers.push({ countryCode: cleanedCode, number: cleanedPhone });
    //     }
    //   }
    // }

    if (phonenumber) {
      if (!user.phonenumbers) user.phonenumbers = [];

      const alreadyExists = user.phonenumbers.some(
        p => p.countryCode === finalCountryCode && p.number === finalPhoneNumber
      );

      if (!alreadyExists) {
        user.phonenumbers.push({ countryCode: finalCountryCode, number: finalPhoneNumber });
      }
    }



    // ✅ Update other basic fields
    if (firstname) user.firstname = firstname;
    if (lastname) user.lastname = lastname;
    if (gender) user.gender = gender;
    if (designation) user.designation = designation;

    // ✅ Ensure userInfo object exists
    if (!user.userInfo) user.userInfo = {};

    user.userInfo.helps = helps;
    user.userInfo.goals = goals;
    user.userInfo.categories = categories;
    user.userInfo.employeeCount = employeeCount;
    user.userInfo.companyName = companyName;

    await user.save();

    res.status(200).json({
      status: "success",
      message: "User onboarding data saved",
      data: {
        email: user.email,
        phonenumbers: user.phonenumbers,
        firstname: user.firstname,
        lastname: user.lastname,
        gender: user.gender,
        designation: user.designation,
        userInfo: user.userInfo
      }
    });
  } catch (error) {
    console.error("Onboarding error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to save onboarding data",
      error: error.message
    });
  }
};




exports.getUserOnboardingData = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("userInfo email");

    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    res.status(200).json({
      status: "success",
      userId: user._id,
      email: user.email,
      userInfo: user.userInfo,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Failed to fetch user onboarding data",
      error: error.message,
    });
  }
};

