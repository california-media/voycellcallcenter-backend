const Contact = require("../models/contactModel");
const User = require("../models/userModel");
const { route } = require("../routes/userRoutes");
const QRCode = require("qrcode");
// const LZString = require("lz-string");
const zlib = require("zlib");
const {
  getOrCreateStripeCustomer,
  getStripeCreditBalance,
  getUserCurrentPlan,
  getUserStripeSubscriptionData,
} = require("../utils/stripeUtils");
const { setupInitialPlan } = require("../utils/planUtils");

const getUserData = async (req, res) => {
  try {
    const {
      searchWhatsappTemplates = "",
      searchEmailTemplates = "",
      whatsappTemplatePage = 1,
      whatsappTemplateLimit = 10,
      emailTemplatePage = 1,
      emailTemplateLimit = 10,
      whatsappTemplateIsFavourite,
      emailTemplateIsFavourite,
      apiType = "web", // <-- ADDED
    } = req.body;

    const isWhatsappFav =
      whatsappTemplateIsFavourite === true ||
      whatsappTemplateIsFavourite === "true";
    const isEmailFav =
      emailTemplateIsFavourite === true || emailTemplateIsFavourite === "true";

    const user = await User.findById(req.user._id).lean();

    if (!user) {
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });
    }

    // Get Stripe credit balance
    let creditBalance = 0;
    if (user.role !== "admin") {
      try {
        const customer = await getOrCreateStripeCustomer(user);
        const stripeCreditBalance = await getStripeCreditBalance(customer.id);
        creditBalance = Math.abs(stripeCreditBalance); // Convert to dollars
      } catch (error) {
        console.error("Error getting Stripe credit balance:", error);
        creditBalance = 0;
      }
    }

    const responseData = {};

    const contactCount = await Contact.countDocuments({ createdBy: user._id });
    const favouriteCount = await Contact.countDocuments({
      createdBy: user._id,
      isFavourite: true,
    });
    const totalWhatsappTemplates = Array.isArray(user.whatsappTemplates)
      ? user.whatsappTemplates.length
      : 0;
    const totalEmailTemplates = Array.isArray(user.emailTemplates)
      ? user.emailTemplates.length
      : 0;
    const totalTemplates = totalWhatsappTemplates + totalEmailTemplates;

    const totalScans =
      (Array.isArray(user.iScanned) ? user.iScanned.length : 0) +
      (Array.isArray(user.scannedMe) ? user.scannedMe.length : 0);

    const whoScannedMeCount = Array.isArray(user.scannedMe)
      ? user.scannedMe.length
      : 0;

    const tagCountAgg = await User.aggregate([
      { $match: { _id: user._id } },
      { $unwind: "$tags" },
      { $count: "tagCount" },
    ]);
    const tagCount = tagCountAgg.length > 0 ? tagCountAgg[0].tagCount : 0;

    // --------- Normalize phonenumbers for response based on apiType ----------
    const phonenumbersForResponse = (() => {
      const phones = Array.isArray(user.phonenumbers) ? user.phonenumbers : [];

      if (apiType === "web") {
        // For web: return array of concatenated digits like ["917046658651"]
        return phones
          .map((p) => {
            if (!p) return null;

            if (typeof p === "string") {
              // strip '+', spaces, parentheses, dashes, etc -> digits only
              return p.replace(/[^\d]/g, "");
            }

            // if stored as object { countryCode, number } (or similar)
            const cc = String(p.countryCode || p.country || "").replace(
              /[^\d]/g,
              ""
            );
            const num = String(
              p.number || p.nationalNumber || p.phone || ""
            ).replace(/[^\d]/g, "");

            // If only `number` exists but already contains country code (e.g., "9170..."), return it cleaned
            if (!cc && num.length > 6) {
              return num;
            }

            // join cc + num (safe even if one of them is empty)
            return (cc + num).replace(/[^\d]/g, "");
          })
          .filter(Boolean); // remove null/empty entries
      }

      // For mobile (or by default) return raw stored structure so mobile UI keeps objects
      return phones;
    })();

    // Only return WhatsApp templates if specifically requested
    if (isWhatsappFav && !isEmailFav) {
      let whatsappTemplates = Array.isArray(user.whatsappTemplates)
        ? user.whatsappTemplates
        : [];
      whatsappTemplates = whatsappTemplates.filter(
        (t) => t.whatsappTemplateIsFavourite === true
      );

      if (searchWhatsappTemplates.trim()) {
        const search = searchWhatsappTemplates.toLowerCase();
        whatsappTemplates = whatsappTemplates.filter(
          (t) =>
            (t.whatsappTemplateTitle || "").toLowerCase().includes(search) ||
            (t.whatsappTemplateMessage || "").toLowerCase().includes(search)
        );
      }

      const total = whatsappTemplates.length;
      const totalPages = Math.ceil(total / whatsappTemplateLimit);
      const paginated = whatsappTemplates.slice(
        (whatsappTemplatePage - 1) * whatsappTemplateLimit,
        whatsappTemplatePage * whatsappTemplateLimit
      );

      // Before return res.json(...)

      const qrPayload = {
        id: user._id,
        firstname: user.firstname,
        lastname: user.lastname,
        phonenumbers: Array.isArray(user.phonenumbers) ? user.phonenumbers : [],
        email: user.email,
        profileImageURL: user.profileImageURL,
        instagram: user.instagram,
        linkedin: user.linkedin,
        telegram: user.telegram,
        twitter: user.twitter,
        facebook: user.facebook,
        designation: user.designation,
      };

      // Step 1: Compress payload
      // const compressed = zlib.deflateSync(JSON.stringify(qrPayload)).toString("base64");
      // const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(qrPayload));

      // Step 2: Encode compressed string into QR
      // const qrCodeDataURL = await QRCode.toDataURL(qrPayload).toString("base64");
      const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrPayload));

      // Generate QR code (as Base64 image)
      // const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrPayload));

      return res.json({
        status: "success",
        message: "Favourite WhatsApp templates fetched successfully.",
        data: {
          id: user._id,
          firstname: user.firstname,
          lastname: user.lastname,
          // phonenumbers: user.phonenumbers,
          phonenumbers: phonenumbersForResponse,
          serialNumber: user.serialNumber,
          email: user.email,
          profileImageURL: user.profileImageURL,
          // qrCode: user.qrCode,
          qrCode: qrCodeDataURL,
          instagram: user.instagram,
          linkedin: user.linkedin,
          telegram: user.telegram,
          twitter: user.twitter,
          facebook: user.facebook,
          designation: user.designation,
          serialNumber: user.serialNumber,
          signupMethod: user.signupMethod,
          role: user.role, // Ensure role is set
          referredBy: user.referredBy || null,
          myReferrals: user.myReferrals || [],
          referralCode: user.referralCode || null,
          trialStartDate: user.trialStart || null,
          trialEndDate: user.trialEnd || null,
          referralUrl: `https://demo.contacts.management/register?ref=${user.referralCode}`,
          creditBalance: creditBalance,
          accounts: [
            {
              type: "google",
              id: user.googleId,
              email: user.googleEmail,
              googleAccessToken: user.googleAccessToken,
              googleRefreshToken: user.googleRefreshToken,
              isConnected: user.googleConnected,
            },
            {
              type: "microsoft",
              id: user.microsoftId,
              email: user.microsoftEmail,
              microsoftAccessToken: user.microsoftAccessToken,
              microsoftRefreshToken: user.microsoftRefreshToken,
              isConnected: user.microsoftConnected,
            },
            {
              type: "smtp",
              id: user.smtpId,
              smtpHost: user.smtpHost,
              smtpPort: user.smtpPort,
              email: user.smtpUser,
              smtpPass: user.smtpPass,
              smtpSecure: user.smtpSecure,
              isConnected: user.smtpConnected,
            },
          ],
          shareProfileCount: user.shareProfileCount || 0,
          contactCount,
          favouriteCount,
          totalTemplates,
          totalScans,
          whoScannedMeCount,
          tagCount,
          templates: {
            whatsappTemplates: {
              whatsappTemplatesData: paginated,
              whatsappTemplatePagination: {
                currentPage: Number(whatsappTemplatePage),
                totalPages,
                totalTemplates: total,
              },
            },
          },
        },
      });
    }

    // Only return Email templates if specifically requested
    if (isEmailFav && !isWhatsappFav) {
      let emailTemplates = Array.isArray(user.emailTemplates)
        ? user.emailTemplates
        : [];
      emailTemplates = emailTemplates.filter(
        (t) => t.emailTemplateIsFavourite === true
      );

      if (searchEmailTemplates.trim()) {
        const search = searchEmailTemplates.toLowerCase();
        emailTemplates = emailTemplates.filter(
          (t) =>
            (t.emailTemplateTitle || "").toLowerCase().includes(search) ||
            (t.emailTemplateSubject || "").toLowerCase().includes(search) ||
            (t.emailTemplateBody || "").toLowerCase().includes(search)
        );
      }

      const total = emailTemplates.length;
      const totalPages = Math.ceil(total / emailTemplateLimit);
      const paginated = emailTemplates.slice(
        (emailTemplatePage - 1) * emailTemplateLimit,
        emailTemplatePage * emailTemplateLimit
      );

      // const qrPayload = {
      //   id: user._id,
      //   firstname: user.firstname,
      //   lastname: user.lastname,
      //   // phonenumbers: user.phonenumbers,
      //   // phonenumbers: phonenumbersForResponse,
      //   phonenumbers: Array.isArray(user.phonenumbers) ? user.phonenumbers : [],
      //   // serialNumber: user.serialNumber,
      //   email: user.email,
      //   profileImageURL: user.profileImageURL,
      //   instagram: user.instagram,
      //   linkedin: user.linkedin,
      //   telegram: user.telegram,
      //   twitter: user.twitter,
      //   facebook: user.facebook,
      //   designation: user.designation,
      //   // signupMethod: user.signupMethod,
      //   // role: user.role,
      //   // referredBy: user.referredBy || null,
      //   // referralCode: user.referralCode || null,
      //   // trialStartDate: user.trialStart || null,
      //   // trialEndDate: user.trialEnd || null,
      //   // referralUrl: `https://app.contacts.management/register?ref=${user.referralCode}`,
      // };

      // Generate QR code (as Base64 image)
      // const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrPayload));

      // Step 1: Compress payload
      // const compressed = zlib.deflateSync(JSON.stringify(qrPayload)).toString("base64");
      // const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(qrPayload));

      // Step 2: Encode compressed string into QR
      // const qrCodeDataURL = await QRCode.toDataURL(qrPayload).toString("base64");
      const qrPayload = {
        id: user._id,
        firstname: user.firstname,
        lastname: user.lastname,
        phonenumbers: Array.isArray(user.phonenumbers) ? user.phonenumbers : [],
        email: user.email,
        profileImageURL: user.profileImageURL,
        instagram: user.instagram,
        linkedin: user.linkedin,
        telegram: user.telegram,
        twitter: user.twitter,
        facebook: user.facebook,
        designation: user.designation,
      };
      const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrPayload));

      return res.json({
        status: "success",
        message: "Favourite Email templates fetched successfully.",
        data: {
          id: user._id,
          firstname: user.firstname,
          lastname: user.lastname,
          // phonenumbers: user.phonenumbers,
          phonenumbers: phonenumbersForResponse,
          serialNumber: user.serialNumber,
          email: user.email,
          profileImageURL: user.profileImageURL,
          // qrCode: user.qrCode,
          instagram: user.instagram,
          linkedin: user.linkedin,
          telegram: user.telegram,
          twitter: user.twitter,
          facebook: user.facebook,
          designation: user.designation,
          signupMethod: user.signupMethod,
          role: user.role,
          referredBy: user.referredBy || null,
          myReferrals: user.myReferrals || [],
          referralCode: user.referralCode || null,
          trialStartDate: user.trialStart || null,
          trialEndDate: user.trialEnd || null,
          referralUrl: `https://demo.contacts.management/register?ref=${user.referralCode}`,
          creditBalance: user.creditBalance || 0,
          qrCode: qrCodeDataURL,
          accounts: [
            {
              type: "google",
              id: user.googleId,
              email: user.googleEmail,
              googleAccessToken: user.googleAccessToken,
              googleRefreshToken: user.googleRefreshToken,
              isConnected: user.googleConnected,
            },
            {
              type: "microsoft",
              id: user.microsoftId,
              email: user.microsoftEmail,
              microsoftAccessToken: user.microsoftAccessToken,
              microsoftRefreshToken: user.microsoftRefreshToken,
              isConnected: user.microsoftConnected,
            },
            {
              type: "smtp",
              id: user.smtpId,
              smtpHost: user.smtpHost,
              smtpPort: user.smtpPort,
              email: user.smtpUser,
              smtpPass: user.smtpPass,
              smtpSecure: user.smtpSecure,
              isConnected: user.smtpConnected,
            },
          ],
          shareProfileCount: user.shareProfileCount || 0,
          contactCount,
          favouriteCount,
          totalTemplates,
          totalScans,
          whoScannedMeCount,
          tagCount,
          templates: {
            emailTemplates: {
              emailTemplatesData: paginated,
              emailTemplatePagination: {
                currentPage: Number(emailTemplatePage),
                totalPages,
                totalTemplates: total,
              },
            },
          },
        },
      });
    }

    const currentPlan = await getUserCurrentPlan(user);

    // Fetch Stripe subscription data if user has a subscription
    const stripeData = await getUserStripeSubscriptionData(user);

    const data = {
      id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      // phonenumbers: user.phonenumbers,
      phonenumbers: phonenumbersForResponse,
      serialNumber: user.serialNumber,
      email: user.email,
      profileImageURL: user.profileImageURL,
      // qrCode: user.qrCode,
      instagram: user.instagram,
      linkedin: user.linkedin,
      telegram: user.telegram,
      twitter: user.twitter,
      facebook: user.facebook,
      designation: user.designation,
      signupMethod: user.signupMethod,
      role: user.role,
      referredBy: user.referredBy || null,
      myReferrals: user.myReferrals || [],
      referralCode: user.referralCode || null,
      trialStartDate: stripeData?.trialStart || null,
      trialEndDate: stripeData?.trialEnd || null,
      referralUrl: `https://demo.contacts.management/register?ref=${user.referralCode}`,
      creditBalance: user.creditBalance || 0,
      accounts: [
        {
          type: "google",
          id: user.googleId,
          email: user.googleEmail,
          googleAccessToken: user.googleAccessToken,
          googleRefreshToken: user.googleRefreshToken,
          isConnected: user.googleConnected,
        },
        {
          type: "microsoft",
          id: user.microsoftId,
          email: user.microsoftEmail,
          microsoftAccessToken: user.microsoftAccessToken,
          microsoftRefreshToken: user.microsoftRefreshToken,
          isConnected: user.microsoftConnected,
        },
        {
          type: "smtp",
          id: user.smtpId,
          smtpHost: user.smtpHost,
          smtpPort: user.smtpPort,
          email: user.smtpUser,
          smtpPass: user.smtpPass,
          smtpSecure: user.smtpSecure,
          isConnected: user.smtpConnected,
        },
      ],
      shareProfileCount: user.shareProfileCount || 0,
      contactCount,
      favouriteCount,
      totalTemplates,
      totalScans,
      whoScannedMeCount,
      plan: {
        _id: currentPlan?._id || null,
        name: currentPlan?.name || null,
        price: currentPlan?.price || 0,
        subscriptionStatus: stripeData?.status || null,
        isTrialing: stripeData?.isTrialing || false,
        activatedAt: stripeData?.activatedAt || null,
        expiresAt: stripeData?.expiresAt || null,
        cancelAtPeriodEnd: stripeData?.cancelAtPeriodEnd || false,
      },
      tagCount,
      templates: {},
    };

    // WhatsApp Templates
    let whatsappTemplates = Array.isArray(user.whatsappTemplates)
      ? user.whatsappTemplates
      : [];
    if (searchWhatsappTemplates.trim()) {
      const search = searchWhatsappTemplates.toLowerCase();
      whatsappTemplates = whatsappTemplates.filter(
        (t) =>
          (t.whatsappTemplateTitle || "").toLowerCase().includes(search) ||
          (t.whatsappTemplateMessage || "").toLowerCase().includes(search)
      );
    }
    const totalWhatsapp = whatsappTemplates.length;
    const totalWhatsappPages = Math.ceil(totalWhatsapp / whatsappTemplateLimit);
    const paginatedWhatsapp = whatsappTemplates.slice(
      (whatsappTemplatePage - 1) * whatsappTemplateLimit,
      whatsappTemplatePage * whatsappTemplateLimit
    );

    // Email Templates
    let emailTemplates = Array.isArray(user.emailTemplates)
      ? user.emailTemplates
      : [];
    if (searchEmailTemplates.trim()) {
      const search = searchEmailTemplates.toLowerCase();
      emailTemplates = emailTemplates.filter(
        (t) =>
          (t.emailTemplateTitle || "").toLowerCase().includes(search) ||
          (t.emailTemplateSubject || "").toLowerCase().includes(search) ||
          (t.emailTemplateBody || "").toLowerCase().includes(search)
      );
    }
    const totalEmail = emailTemplates.length;
    const totalEmailPages = Math.ceil(totalEmail / emailTemplateLimit);
    const paginatedEmail = emailTemplates.slice(
      (emailTemplatePage - 1) * emailTemplateLimit,
      emailTemplatePage * emailTemplateLimit
    );

    data.templates.whatsappTemplates = {
      whatsappTemplatesData: paginatedWhatsapp,
      whatsappTemplatePagination: {
        currentPage: Number(whatsappTemplatePage),
        totalPages: totalWhatsappPages,
        totalTemplates: totalWhatsapp,
      },
    };

    data.templates.emailTemplates = {
      emailTemplatesData: paginatedEmail,
      emailTemplatePagination: {
        currentPage: Number(emailTemplatePage),
        totalPages: totalEmailPages,
        totalTemplates: totalEmail,
      },
    };

    // const qrPayload = {
    //   id: user._id,
    //   firstname: user.firstname,
    //   lastname: user.lastname,
    //   // phonenumbers: user.phonenumbers,
    //   // phonenumbers: phonenumbersForResponse,
    //   phonenumbers: Array.isArray(user.phonenumbers) ? user.phonenumbers : [],
    //   // serialNumber: user.serialNumber,
    //   email: user.email,
    //   profileImageURL: user.profileImageURL,
    //   instagram: user.instagram,
    //   linkedin: user.linkedin,
    //   telegram: user.telegram,
    //   twitter: user.twitter,
    //   facebook: user.facebook,
    //   designation: user.designation,
    //   // signupMethod: user.signupMethod,
    //   // role: user.role,
    //   // referredBy: user.referredBy || null,
    //   // referralCode: user.referralCode || null,
    //   // referralUrl: `https://app.contacts.management/register?ref=${user.referralCode}`,
    // };

    // Generate QR code (as Base64 image)
    // const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrPayload));

    // Step 1: Compress payload
    // const compressed = zlib.deflateSync(JSON.stringify(qrPayload)).toString("base64");
    // const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(qrPayload));
    // console.log("Compressed QR Payload:", compressed);

    // Step 2: Encode compressed string into QR
    // const qrCodeDataURL = await QRCode.toDataURL(qrPayload).toString("base64");

    const qrPayload = {
      id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      phonenumbers: Array.isArray(user.phonenumbers) ? user.phonenumbers : [],
      email: user.email,
      profileImageURL: user.profileImageURL,
      instagram: user.instagram,
      linkedin: user.linkedin,
      telegram: user.telegram,
      twitter: user.twitter,
      facebook: user.facebook,
      designation: user.designation,
    };

    const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(qrPayload));

    // console.log("Generated QR Code Data URL:", qrCodeDataURL);

    data.qrCode = qrCodeDataURL;

    return res.json({
      status: "success",
      message: "User and templates fetched successfully.",
      data,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
};

module.exports = { getUserData };
