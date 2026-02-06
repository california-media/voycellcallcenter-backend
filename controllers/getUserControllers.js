const User = require("../models/userModel");
const Lead = require("../models/leadModel");
const Contact = require("../models/contactModel");
const mongoose = require("mongoose");
const YeastarToken = require("../models/YeastarToken");
const { getValidToken } = require("../utils/yeastarClient");
const axios = require("axios");

const YEASTAR_BASE_URL = process.env.YEASTAR_BASE_URL?.trim();
const YEASTAR_SDK_ACCESS_ID = process.env.YEASTAR_SDK_ACCESS_ID?.trim();
const YEASTAR_SDK_ACCESS_KEY = process.env.YEASTAR_SDK_ACCESS_KEY?.trim();

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

    const ContactCount = await Contact.countDocuments({
      createdBy: new mongoose.Types.ObjectId(req.user._id),
    });

    const LeadCount = await Lead.countDocuments({
      createdBy: new mongoose.Types.ObjectId(req.user._id),
    });

    // --------- Normalize phonenumbers for response based on apiType ----------
    const phonenumbersForResponse = (() => {
      const phones = Array.isArray(user.phonenumbers) ? user.phonenumbers : [];

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

      // For mobile (or by default) return raw stored structure so mobile UI keeps objects
      return phones;
    })();

    // Fetch Yeastar signature if user has extension
    // let yeastarSignature = null;
    // let pbxURL = null;

    // if (user.extensionNumber && user.yeastarExtensionId) {
    //   try {
    //     const signatureData = await getYeastarSignature(user.extensionNumber);
    //     if (signatureData) {
    //       yeastarSignature = signatureData.signature;
    //       pbxURL = signatureData.pbxURL;
    //     }
    //   } catch (err) {
    //     console.error("❌ Failed to fetch Yeastar signature for user:", err);
    //     // Don't fail the whole request if signature fetch fails
    //   }
    // }

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

      return res.json({
        status: "success",
        message: "Favourite WhatsApp templates fetched successfully.",
        data: {
          id: user._id,
          firstname: user.firstname,
          lastname: user.lastname,
          gender: user.gender,
          email: user.email,
          profileImageURL: user.profileImageURL,
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
          isActive: user.isActive,
          lastSeen: user.lastSeen,
          contactCount: ContactCount,
          leadCount: LeadCount,
          phonenumbers: phonenumbersForResponse,
          popupSettings: user.popupSettings || {},
          accounts: {
            email: [
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
            crm: [
              {
                type: "zoho",
                domain: user.zoho?.dc || null,
                isConnected: user.zoho?.isConnected || false,
                accessToken: user.zoho?.accessToken || null,
                refreshToken: user.zoho?.refreshToken || null,
                userId: user.zoho?.userId || null,
                timezone: user.zoho?.timezone || null,
                accountsUrl: user.zoho?.accountsUrl || null,
                apiBaseUrl: user.zoho?.apiBaseUrl || null,
              },
              {
                type: "meta",
                isConnected: user.meta?.isConnected || false,
                facebookUserId: user.meta?.facebookUserId || null,
                pageId: user.meta?.pageId || null,
                subscribedPages: user.meta?.subscribedPages || [],
              },
              {
                type: "zoom",
                isConnected: user.zoom?.isConnected || false,
                userId: user.zoom?.userId || null,
                email: user.zoom?.email || null,
                accessToken: user.zoom?.accessToken || null,
                refreshToken: user.zoom?.refreshToken || null,
              },
            ],
          },
          isVerified: user.isVerified,
          userInfo: user.userInfo || {
            helps: [],
            goals: "",
            categories: "",
            employeeCount: "",
            companyName: "",
          },
          extensionNumber: user.extensionNumber || null,
          extensionStatus: user.extensionStatus || null,
          telephone: user.telephone || "",
          yeastarExtensionId: user.yeastarExtensionId || null,
          sipSecret: user.sipSecret || null,
          yeastarProvisionStatus: user.yeastarProvisionStatus || "pending",
          yeastarProvisionError: user.yeastarProvisionError || "",
          createdAt: user.createdAt,
          yestarBaseURL: YEASTAR_BASE_URL || null,
          contactStatuses: user.contactStatuses || [],
          leadStatuses: user.leadStatuses || [],
          accountStatus: user.accountStatus === "active",
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

      return res.json({
        status: "success",
        message: "Favourite Email templates fetched successfully.",
        data: {
          id: user._id,
          firstname: user.firstname,
          lastname: user.lastname,
          gender: user.gender,
          email: user.email,
          profileImageURL: user.profileImageURL,
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
          isActive: user.isActive,
          lastSeen: user.lastSeen,
          contactCount: ContactCount,
          leadCount: LeadCount,
          phonenumbers: phonenumbersForResponse,
          popupSettings: user.popupSettings || {},
          accounts: {
            email: [
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
            crm: [
              {
                type: "zoho",
                domain: user.zoho?.dc || null,
                isConnected: user.zoho?.isConnected || false,
                accessToken: user.zoho?.accessToken || null,
                refreshToken: user.zoho?.refreshToken || null,
                userId: user.zoho?.userId || null,
                timezone: user.zoho?.timezone || null,
                accountsUrl: user.zoho?.accountsUrl || null,
                apiBaseUrl: user.zoho?.apiBaseUrl || null,
              },
              {
                type: "meta",
                isConnected: user.meta?.isConnected || false,
                facebookUserId: user.meta?.facebookUserId || null,
                pageId: user.meta?.pageId || null,
                subscribedPages: user.meta?.subscribedPages || [],
              },
              {
                type: "zoom",
                isConnected: user.zoom?.isConnected || false,
                userId: user.zoom?.userId || null,
                email: user.zoom?.email || null,
                accessToken: user.zoom?.accessToken || null,
                refreshToken: user.zoom?.refreshToken || null,
              },
            ],
          },
          isVerified: user.isVerified,
          userInfo: user.userInfo || {
            helps: [],
            goals: "",
            categories: "",
            employeeCount: "",
            companyName: "",
          },
          extensionNumber: user.extensionNumber || null,
          extensionStatus: user.extensionStatus || null,
          telephone: user.telephone || "",
          yeastarExtensionId: user.yeastarExtensionId || null,
          sipSecret: user.sipSecret || null,
          yeastarProvisionStatus: user.yeastarProvisionStatus || "pending",
          yeastarProvisionError: user.yeastarProvisionError || "",
          createdAt: user.createdAt,
          yestarBaseURL: YEASTAR_BASE_URL || null,
          contactStatuses: user.contactStatuses || [],
          leadStatuses: user.leadStatuses || [],
          accountStatus: user.accountStatus === "active",
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

    const data = {
      id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      gender: user.gender,
      email: user.email,
      profileImageURL: user.profileImageURL,
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
      isActive: user.isActive,
      lastSeen: user.lastSeen,
      contactCount: ContactCount,
      leadCount: LeadCount,
      phonenumbers: phonenumbersForResponse,
      popupSettings: user.popupSettings || {},
      accounts: {
        email: [
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
        crm: [
          {
            type: "zoho",
            domain: user.zoho?.dc || null,
            isConnected: user.zoho?.isConnected || false,
            accessToken: user.zoho?.accessToken || null,
            refreshToken: user.zoho?.refreshToken || null,
            userId: user.zoho?.userId || null,
            timezone: user.zoho?.timezone || null,
            accountsUrl: user.zoho?.accountsUrl || null,
            apiBaseUrl: user.zoho?.apiBaseUrl || null,
          },
          {
            type: "meta",
            isConnected: user.meta?.isConnected || false,
            facebookUserId: user.meta?.facebookUserId || null,
            pageId: user.meta?.pageId || null,
            subscribedPages: user.meta?.subscribedPages || [],
          },
          {
            type: "zoom",
            isConnected: user.zoom?.isConnected || false,
            userId: user.zoom?.userId || null,
            email: user.zoom?.email || null,
            accessToken: user.zoom?.accessToken || null,
            refreshToken: user.zoom?.refreshToken || null,
          },
        ],
      },
      isVerified: user.isVerified,
      userInfo: user.userInfo || {
        helps: [],
        goals: "",
        categories: "",
        employeeCount: "",
        companyName: "",
      },
      extensionNumber: user.extensionNumber || null,
      extensionStatus: user.extensionStatus || null,
      telephone: user.telephone || "",
      yeastarExtensionId: user.yeastarExtensionId || null,
      sipSecret: user.sipSecret || null,
      yeastarProvisionStatus: user.yeastarProvisionStatus || "pending",
      yeastarProvisionError: user.yeastarProvisionError || "",
      createdAt: user.createdAt,
      yestarBaseURL: YEASTAR_BASE_URL || null,
      contactStatuses: user.contactStatuses || [],
      leadStatuses: user.leadStatuses || [],
      accountStatus: user.accountStatus === "active",
      templates: {},
      // yeastarSignature: yeastarSignature,
      // pbxURL: pbxURL,
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

    return res.json({
      status: "success",
      message: "User data and templates fetched successfully.",
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
