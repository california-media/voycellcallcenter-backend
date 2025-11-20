// const Contact = require("../models/contactModel");

// exports.getAllContactsOrLeads = async (req, res) => {
//   try {
//     const {
//       isLead = false,
//       page = 1,
//       limit = 10,
//       search = "",
//       tag = "",
//       sorted = false,
//       isFavourite = false,
//     } = req.body;

//     const createdBy = req.user._id;

//     // -------------------------------
//     // 🔍 Build Base Query
//     // -------------------------------
//     const query = { createdBy, isLead };

//     // Filter by favourite
//     if (isFavourite === true || isFavourite === "true") {
//       query.isFavourite = true;
//     }

//     // -------------------------------
//     // 🔍 Search Filter (case-insensitive)
//     // -------------------------------
//     if (search?.trim()) {
//       const searchText = search.trim();
//       const regex = new RegExp(searchText, "i"); // Case-insensitive regex

//       query.$or = [
//         { firstname: regex },
//         { lastname: regex },
//         { emailAddresses: { $elemMatch: { $regex: regex } } },
//         {
//           phonenumbers: {
//             $elemMatch: { number: { $regex: regex } }, // partial number search
//           },
//         },
//         {
//           $expr: {
//             $regexMatch: {
//               input: { $concat: ["$firstname", " ", "$lastname"] },
//               regex: searchText, // plain string here, not RegExp
//             },
//           },
//         },
//       ];
//     }

//     // -------------------------------
//     // 🏷️ Tag Filter
//     // -------------------------------
//     if (Array.isArray(tag) && tag.length > 0) {
//       query["tags.tag"] = { $in: tag.map((t) => new RegExp(`^${t}$`, "i")) };
//     } else if (typeof tag === "string" && tag.trim() !== "") {
//       query["tags.tag"] = { $regex: `^${tag.trim()}$`, $options: "i" };
//     }

//     // -------------------------------
//     // 📊 Pagination
//     // -------------------------------
//     const totalCount = await Contact.countDocuments(query);
//     const totalPages = Math.ceil(totalCount / limit);
//     const skip = (page - 1) * limit;

//     // -------------------------------
//     // 📋 Fetch Data
//     // -------------------------------
//     const items = await Contact.find(query)
//       .sort(sorted ? { firstname: 1, lastname: 1 } : { createdAt: -1, _id: -1 })
//       .skip(skip)
//       .limit(parseInt(limit))
//       .select("-updatedAt -__v")
//       .lean();

//     // -------------------------------
//     // 🧹 Clean Data
//     // -------------------------------
//     const data = items.map((item) => {
//       // Normalize phone numbers
//       item.phoneNumbers = Array.isArray(item.phonenumbers)
//         ? item.phonenumbers.filter(
//             (p) =>
//               (p?.number && p.number.trim()) ||
//               (p?.countryCode && p.countryCode.trim())
//           )
//         : [];

//       // Normalize tags
//       item.tags = Array.isArray(item.tags)
//         ? item.tags.map((t) => ({
//             tag: t.tag,
//             emoji: t.emoji || "",
//           }))
//         : [];

//       item.contact_id = item._id?.toString();
//       return item;
//     });

//     // -------------------------------
//     // ✅ Response
//     // -------------------------------
//     res.status(200).json({
//       status: "success",
//       message: isLead
//         ? "Leads fetched successfully"
//         : "Contacts fetched successfully",
//       data,
//       pagination: {
//         currentPage: parseInt(page),
//         totalPages,
//         totalItems: totalCount,
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching contacts/leads:", error);
//     res.status(500).json({
//       status: "error",
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };

const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
/**
 * Escape string for RegExp
 */
const escapeRegex = (str = "") =>
  String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

exports.getAllContactsOrLeads = async (req, res) => {
  try {
    const {
      isLead = false,
      category,
      page = 1,
      limit = 10,
      search = "",
      tag = "",
      sorted = false,
      isFavourite = false,
      status = "",
    } = req.body;

    const createdBy = req.user._id;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * perPage;

    var Model;
    if (category === "lead") {
      Model = Lead;
    } else {
      Model = Contact;
    }

    // Base query
    const query = { createdBy };

    // Filter favourites - only filter if explicitly set to true
    if (isFavourite === true || String(isFavourite).toLowerCase() === "true") {
      query.isFavourite = true;
    }
    // Note: If isFavourite is false or null, we show all contacts (no filter)

    // Filter by status - direct string matching
    if (Array.isArray(status) && status.length > 0) {
      // Simple $in with string values
      query.status = { $in: status };
    } else if (typeof status === "string" && status.trim() !== "") {
      query.status = status.trim();
    }

    // Filter by tags
    if (Array.isArray(tag) && tag.length > 0) {
      query["tags.tag"] = {
        $in: tag.map((t) => new RegExp(`^${escapeRegex(t)}$`, "i")),
      };
    } else if (typeof tag === "string" && tag.trim() !== "") {
      query["tags.tag"] = {
        $regex: `^${escapeRegex(tag.trim())}$`,
        $options: "i",
      };
    }

    // -----------------------
    // Search (Name, Email, Phone)
    // -----------------------
    if (search && String(search).trim() !== "") {
      const raw = String(search).trim();
      const escaped = escapeRegex(raw);
      const regexInsensitive = new RegExp(escaped, "i");

      const or = [
        { firstname: { $regex: regexInsensitive } },
        { lastname: { $regex: regexInsensitive } },
        { emailAddresses: { $elemMatch: { $regex: regexInsensitive } } },
        {
          $expr: {
            $regexMatch: {
              input: {
                $toLower: { $concat: ["$firstname", " ", "$lastname"] },
              },
              regex: raw.toLowerCase(),
            },
          },
        },
      ];

      // Match phone number or country code individually
      or.push({ "phoneNumbers.number": { $regex: regexInsensitive } });
      or.push({ "phoneNumbers.countryCode": { $regex: regexInsensitive } });

      // If numeric search: also match concatenated countryCode+number using regex on both fields
      const digitsOnly = raw.replace(/\D/g, "");
      if (digitsOnly.length > 0) {
        const phoneRegex = new RegExp(escapeRegex(digitsOnly));
        or.push({
          $or: [
            { "phoneNumbers.number": { $regex: phoneRegex } },
            { "phoneNumbers.countryCode": { $regex: phoneRegex } },
            // Match when number starts or ends with search digits
            {
              "phoneNumbers.number": {
                $regex: new RegExp(`${escapeRegex(digitsOnly)}$`),
              },
            },
            {
              "phoneNumbers.number": {
                $regex: new RegExp(`^${escapeRegex(digitsOnly)}`),
              },
            },
          ],
        });
      }

      query.$or = or;
    }

    // -----------------------
    // Count & Fetch
    // -----------------------
    const totalCount = await Model.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

    const items = await Model.find(query)
      .sort(sorted ? { firstname: 1, lastname: 1 } : { createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(perPage)
      .select("-__v -updatedAt -createdBy")
      .lean();

    // -----------------------
    // Format Results
    // -----------------------
    const data = items.map((item) => {
      // Clean phone numbers
      if (Array.isArray(item.phoneNumbers)) {
        item.phoneNumbers = item.phoneNumbers
          .filter(
            (p) =>
              p &&
              ((p.number && p.number.trim()) ||
                (p.countryCode && p.countryCode.trim()))
          )
          .map((p) => ({
            countryCode: p.countryCode?.trim() || "",
            number: p.number?.trim() || "",
          }));
      } else {
        item.phoneNumbers = [];
      }

      // Clean emails
      item.emailAddresses = Array.isArray(item.emailAddresses)
        ? item.emailAddresses.filter((e) => e && e.trim())
        : [];

      // Clean tags
      item.tags = Array.isArray(item.tags)
        ? item.tags.map((t) => ({ tag: t.tag, emoji: t.emoji || "" }))
        : [];

      // Add contact_id alias
      item.contact_id = item._id?.toString();
      return item;
    });

    // -----------------------
    // Response
    // -----------------------
    return res.status(200).json({
      status: "success",
      message: category === "lead"
        ? "Leads fetched successfully"
        : "Contacts fetched successfully",
      data,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems: totalCount,
      },
    });
  } catch (err) {
    console.error("getAllContactsOrLeads error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: err.message,
    });
  }
};

/**
 * Get a single contact or lead by ID
 */
exports.getSingleContactOrLead = async (req, res) => {
  try {
    const { contact_id } = req.body;
    const createdBy = req.user._id;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required",
      });
    }

    const contact = await Contact.findOne({
      _id: contact_id,
      createdBy,
    })
      .select("-__v -updatedAt -createdBy")
      .lean();

    if (!contact) {
      return res.status(404).json({
        status: "error",
        message: "Contact not found",
      });
    }

    // Clean phone numbers
    if (Array.isArray(contact.phoneNumbers)) {
      contact.phoneNumbers = contact.phoneNumbers
        .filter(
          (p) =>
            p &&
            ((p.number && p.number.trim()) ||
              (p.countryCode && p.countryCode.trim()))
        )
        .map((p) => ({
          countryCode: p.countryCode?.trim() || "",
          number: p.number?.trim() || "",
        }));
    } else {
      contact.phoneNumbers = [];
    }

    // Clean emails
    contact.emailAddresses = Array.isArray(contact.emailAddresses)
      ? contact.emailAddresses.filter((e) => e && e.trim())
      : [];

    // Clean tags
    contact.tags = Array.isArray(contact.tags)
      ? contact.tags.map((t) => ({ tag: t.tag, emoji: t.emoji || "" }))
      : [];

    // Add contact_id alias
    contact.contact_id = contact._id?.toString();

    return res.status(200).json({
      status: "success",
      message: contact.isLead
        ? "Lead fetched successfully"
        : "Contact fetched successfully",
      data: contact,
    });
  } catch (err) {
    console.error("getSingleContactOrLead error:", err);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: err.message,
    });
  }
};
