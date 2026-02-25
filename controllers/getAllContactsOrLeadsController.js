const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const User = require("../models/userModel");
const mongoose = require("mongoose");

/**
 * Escape string for RegExp
 */
const escapeRegex = (str = "") =>
  String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function normalizePhone(value = "") {
  return value.replace(/\D/g, ""); // remove +, spaces, -, etc
}

exports.getAllContactsOrLeads = async (req, res) => {
  try {
    const {
      category,
      page = 1,
      limit = 10,
      search = "",
      tag = [],
      sorted = false,
      isFavourite = false,
      status = "",
      agentId = [],   // ✅ ADD THIS
    } = req.body;

    // const createdBy = req.user._id;
    const userId = req.user._id;
    const user = await User.findById(userId).select("role");
    const userRole = user.role;
    // -----------------------  
    // Pagination Setup
    // -----------------------
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * perPage;

    let allowedUserIds = [userId];
    if (userRole === "companyAdmin") {
      const agents = await User.find(
        { createdByWhichCompanyAdmin: userId },
        { _id: 1 }
      ).lean();

      const agentIds = agents.map(a => a._id);
      allowedUserIds = [userId, ...agentIds];
    }

    var Model;
    if (category === "lead") {
      Model = Lead;
    } else {
      Model = Contact;
    }

    // -----------------------
    // Agent Filter
    // -----------------------
    if (Array.isArray(agentId) && agentId.length > 0) {
      const validAgentIds = agentId
        .map(id => {
          try {
            return new mongoose.Types.ObjectId(id);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      // Intersect with allowedUserIds (security!)
      allowedUserIds = allowedUserIds.filter(id =>
        validAgentIds.some(aid => aid.equals(id))
      );
    }

    const query = {
      createdBy: { $in: allowedUserIds }
    };

    // -----------------------
    // Filters
    // -----------------------

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

    // -----------------------
    // Filter by tags (MULTIPLE TAGS - ANY MATCH)
    // -----------------------
    if (Array.isArray(tag) && tag.length > 0) {
      query["tags.tag"] = {
        $in: tag
          .filter(t => typeof t === "string" && t.trim() !== "")
          .map(t => new RegExp(`^${escapeRegex(t.trim())}$`, "i")),
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
              regex: escapeRegex(raw.toLowerCase()),
              options: "i",
            },
          },
        },
      ];

      // Extract only digits for phone search (handles +92 3303521767 → 923303521767)
      const digitsOnly = raw.replace(/\D/g, "");

      if (digitsOnly.length > 0) {
        // Search in concatenated countryCode + number
        or.push({
          $expr: {
            $regexMatch: {
              input: {
                $reduce: {
                  input: "$phoneNumbers",
                  initialValue: "",
                  in: {
                    $concat: [
                      "$$value",
                      { $ifNull: ["$$this.countryCode", ""] },
                      { $ifNull: ["$$this.number", ""] },
                      "|", // separator to allow multiple phone numbers
                    ],
                  },
                },
              },
              regex: escapeRegex(digitsOnly),
              options: "i",
            },
          },
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
      .select("-__v -updatedAt")
      .lean();


    const usersMap = {};

    const users = await User.find(
      { _id: { $in: allowedUserIds } },
      { firstname: 1, lastname: 1, tags: 1 }
    ).lean();

    users.forEach(u => {
      usersMap[u._id.toString()] = `${u.firstname || ""} ${u.lastname || ""}`.trim();
    });

    const userTagsMap = {};

    users.forEach(u => {
      userTagsMap[u._id.toString()] = Array.isArray(u.tags)
        ? u.tags.map(t => t.tag_id.toString())
        : [];
    });

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

      // ------------------------------------------------------------------
      // Filter tags based on LOGGED-IN USER only (Matching by tag_id)
      // ------------------------------------------------------------------
      if (Array.isArray(item.tags)) {
        const requesterId = userId.toString();
        const allowedTags = users.find(u => u._id.toString() === requesterId)?.tags || [];
        const allowedTagIdStrings = allowedTags.map(t => t.tag_id.toString());

        item.tags = item.tags
          .filter(t => t.tag_id && allowedTagIdStrings.includes(t.tag_id.toString()))
          .map(t => {
            // Find the tag details from the requester's profile for consistency
            const matchedTag = allowedTags.find(at => at.tag_id.toString() === t.tag_id.toString());
            return {
              tag_id: t.tag_id,
              tag: matchedTag ? matchedTag.tag : t.tag,
              emoji: matchedTag ? matchedTag.emoji : (t.emoji || "")
            };
          });
      } else {
        item.tags = [];
      }

      // Add contact_id alias
      item.contact_id = item._id?.toString();
      // ✅ ADD AGENT NAME
      item.agentName = usersMap[item.createdBy?.toString()] || "";

      // Optional: also expose agentId if frontend wants it
      item.agentId = item.createdBy?.toString();
      return item;
    });

    // -----------------------
    // Fetch agent names
    // -----------------------



    // -----------------------
    // Response
    // -----------------------

    return res.status(200).json({
      status: "success",
      message:
        category === "lead"
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
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: err.message,
    });
  }
};


exports.getAllActivities = async (req, res) => {
  try {
    const { contact_id, category } = req.query;
    const createdBy = req.user._id;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required",
      });
    }

    if (!category) {
      return res.status(400).json({
        status: "error",
        message: "category is required (contact or lead)",
      });
    }

    // Determine which model to use based on category
    var Model;
    if (category === "lead") {
      Model = Lead;
    } else {
      Model = Contact;
    }

    const record = await Model.findOne({
      _id: contact_id,
      createdBy,
    })
      .select("activities")
      .lean();

    if (!record) {
      return res.status(404).json({
        status: "error",
        message: `${category} not found`,
      });
    }

    // Sort activities by timestamp descending (newest first)
    const activities = (record.activities || []).sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    return res.status(200).json({
      status: "success",
      message: "Activities fetched successfully",
      data: activities,
    });
  } catch (err) {
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
    const { contact_id, category } = req.body;
    // const createdBy = req.user._id;
    const loginUserId = req.user._id;
    const user = await User.findById(loginUserId).select("role");
    const loginUserRole = user.role;

    if (!contact_id) {
      return res.status(400).json({
        status: "error",
        message: "contact_id is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(contact_id)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid contact_id",
      });
    }

    // Determine which model to use based on category
    var Model;
    if (category === "lead") {
      Model = Lead;
    } else {
      Model = Contact;
    }

    let query = {
      contact_id: contact_id,
    };

    if (loginUserRole === "user") {
      // agent → only their own contacts
      query.createdBy = loginUserId;
    }

    if (loginUserRole === "companyAdmin") {

      // 1️⃣ Get all agents under this company admin
      const agentIds = await User.find({
        createdByWhichCompanyAdmin: loginUserId,
        role: "user",
      }).distinct("_id");

      // 2️⃣ Allow admin's own + agents' contacts
      query.createdBy = {
        $in: [loginUserId, ...agentIds],
      };
    }

    // -----------------------
    // Fetch relevant users for names and tag filtering
    // -----------------------
    let userQuery = { _id: loginUserId };
    if (loginUserRole === "companyAdmin") {
      userQuery = {
        $or: [
          { _id: loginUserId },
          { createdByWhichCompanyAdmin: loginUserId }
        ]
      };
    }
    const users = await User.find(userQuery).select("tags _id firstname lastname").lean();
    const usersMap = {};
    users.forEach((u) => {
      usersMap[u._id.toString()] = `${u.firstname} ${u.lastname}`.trim();
    });

    const contact = await Model.findOne(query)
      .select("-__v -updatedAt")
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

    // ------------------------------------------------------------------
    // Filter tags based on LOGGED-IN USER only (Matching by tag_id)
    // ------------------------------------------------------------------
    if (Array.isArray(contact.tags)) {
      const requesterId = loginUserId.toString();
      const allowedTags = users.find(u => u._id.toString() === requesterId)?.tags || [];
      const allowedTagIdStrings = allowedTags.map(t => t.tag_id.toString());

      contact.tags = contact.tags
        .filter(t => t.tag_id && allowedTagIdStrings.includes(t.tag_id.toString()))
        .map(t => {
          const matchedTag = allowedTags.find(at => at.tag_id.toString() === t.tag_id.toString());
          return {
            tag_id: t.tag_id,
            tag: matchedTag ? matchedTag.tag : t.tag,
            emoji: matchedTag ? matchedTag.emoji : (t.emoji || "")
          };
        });
    } else {
      contact.tags = [];
    }

    // Add contact_id alias
    contact.contact_id = contact._id?.toString();

    // ✅ ADD AGENT NAME AND ID
    contact.agentName = usersMap[contact.createdBy?.toString()] || "";
    contact.agentId = contact.createdBy?.toString();

    return res.status(200).json({
      status: "success",
      message:
        category === "lead"
          ? "Lead fetched successfully"
          : "Contact fetched successfully",
      data: contact,
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: err.message,
    });
  }
};


exports.getAllContactOrLeadForEvent = async (req, res) => {
  try {
    const createdBy = req.user._id;
    const { search = "" } = req.query;

    // Base query for both contacts and leads
    const baseQuery = { createdBy };

    // Add search functionality if search term is provided
    if (search && search.trim() !== "") {
      const searchTerm = search.trim();
      const escaped = escapeRegex(searchTerm);
      const regexInsensitive = new RegExp(escaped, "i");

      const normalizedPhone = normalizePhone(searchTerm);
      const phoneRegex =
        normalizedPhone.length > 0 ? new RegExp(normalizedPhone) : null;

      // 🔹 Phone search conditions
      const phoneConditions = [];

      if (phoneRegex) {
        // 1️⃣ Match phone number only (e.g. 5555)
        phoneConditions.push({
          phoneNumbers: {
            $elemMatch: {
              number: { $regex: phoneRegex },
            },
          },
        });

        // 2️⃣ Match country code only (e.g. 91)
        phoneConditions.push({
          phoneNumbers: {
            $elemMatch: {
              countryCode: { $regex: phoneRegex },
            },
          },
        });

        // 3️⃣ Match combined countryCode + number (e.g. 9155)
        if (normalizedPhone.length > 2) {
          phoneConditions.push({
            $and: [
              {
                phoneNumbers: {
                  $elemMatch: {
                    countryCode: normalizedPhone.slice(0, 2),
                  },
                },
              },
              {
                phoneNumbers: {
                  $elemMatch: {
                    number: { $regex: normalizedPhone.slice(2) },
                  },
                },
              },
            ],
          });
        }
      }

      baseQuery.$or = [
        // ✅ First name
        { firstname: { $regex: regexInsensitive } },

        // ✅ Last name
        { lastname: { $regex: regexInsensitive } },

        // ✅ Emails
        { emailAddresses: { $elemMatch: { $regex: regexInsensitive } } },

        // ✅ Full name search (top-level $expr is OK)
        {
          $expr: {
            $regexMatch: {
              input: {
                $toLower: { $concat: ["$firstname", " ", "$lastname"] },
              },
              regex: searchTerm.toLowerCase(),
            },
          },
        },
        // ✅ Phone search (all variants)
        ...phoneConditions,
      ];
    }



    // Fetch contacts
    const contacts = await Contact.find(baseQuery)
      .select("_id emailAddresses firstname lastname phoneNumbers isWabaChat")
      .limit(50) // Limit results for better performance
      .lean();

    // Add category field
    const contactData = contacts.map((c) => ({
      id: c._id.toString(),
      firstname: c.firstname || "",
      lastname: c.lastname || "",
      emailAddresses: c.emailAddresses || [],
      phoneNumbers: c.phoneNumbers || [],
      category: "contact",
      isWabaChat: c.isWabaChat || false,
    }));

    // Fetch leads
    const leads = await Lead.find(baseQuery)
      .select("_id emailAddresses firstname lastname phoneNumbers isWabaChat")
      .limit(50) // Limit results for better performance
      .lean();

    // Add category field
    const leadData = leads.map((l) => ({
      id: l._id.toString(),
      firstname: l.firstname || "",
      lastname: l.lastname || "",
      emailAddresses: l.emailAddresses || [],
      phoneNumbers: l.phoneNumbers || [],
      category: "lead",
      isWabaChat: l.isWabaChat || false,
    }));

    // Combine both
    const finalData = [...contactData, ...leadData];

    return res.status(200).json({
      status: "success",
      message: "Email addresses fetched successfully",
      data: finalData,
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: err.message,
    });
  }
};

exports.searchByPhone = async (req, res) => {
  try {
    const { phone } = req.query; // ✅ search input from query params
    const requesterId = req.user._id;
    const user = await User.findById(requesterId).select("role");
    const requesterRole = user.role;

    if (!phone) {
      return res.status(400).json({
        status: "error",
        message: "Phone number is required",
      });
    }

    // ✅ Extract only digits from search input (handles +968 3459232323 → 9683459232323)
    const searchDigits = phone.replace(/\D/g, "");

    if (!searchDigits) {
      return res.status(400).json({
        status: "error",
        message: "Please enter valid phone number digits",
      });
    }

    let ownerIds = [];

    // ✅ CASE 1: If logged-in user is Company Admin
    if (requesterRole === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: requesterId,
      }).select("_id");
      ownerIds = agents.map((a) => a._id);
      ownerIds.push(requesterId); // ✅ include admin himself
    }

    // ✅ CASE 2: If logged-in user is Agent/User
    else if (requesterRole === "user") {
      const currentUser = await User.findById(requesterId).select(
        "createdByWhichCompanyAdmin"
      );

      if (currentUser?.createdByWhichCompanyAdmin) {
        const agents = await User.find({
          createdByWhichCompanyAdmin: currentUser.createdByWhichCompanyAdmin,
        }).select("_id");

        ownerIds = agents.map((a) => a._id);
        ownerIds.push(currentUser.createdByWhichCompanyAdmin);
      } else {
        ownerIds = [requesterId];
      }
    }

    // ✅ FINAL FILTER
    const ownerFilter = {
      createdBy: { $in: ownerIds.map((id) => new mongoose.Types.ObjectId(id)) },
    };

    // ✅ SEARCH CONTACTS using aggregation to concat countryCode + number
    const contacts = await Contact.aggregate([
      {
        $match: ownerFilter,
      },
      {
        $addFields: {
          fullPhoneNumbers: {
            $map: {
              input: "$phoneNumbers",
              as: "phone",
              in: {
                $concat: [
                  { $ifNull: ["$$phone.countryCode", ""] },
                  { $ifNull: ["$$phone.number", ""] },
                ],
              },
            },
          },
        },
      },
      {
        $match: {
          fullPhoneNumbers: {
            $elemMatch: {
              $regex: searchDigits,
              $options: "i",
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "createdByUser",
        },
      },
      {
        $unwind: {
          path: "$createdByUser",
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    // ✅ SEARCH LEADS using aggregation
    const leads = await Lead.aggregate([
      {
        $match: ownerFilter,
      },
      {
        $addFields: {
          fullPhoneNumbers: {
            $map: {
              input: "$phoneNumbers",
              as: "phone",
              in: {
                $concat: [
                  { $ifNull: ["$$phone.countryCode", ""] },
                  { $ifNull: ["$$phone.number", ""] },
                ],
              },
            },
          },
        },
      },
      {
        $match: {
          fullPhoneNumbers: {
            $elemMatch: {
              $regex: searchDigits,
              $options: "i",
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "createdByUser",
        },
      },
      {
        $unwind: {
          path: "$createdByUser",
          preserveNullAndEmptyArrays: true,
        },
      },
    ]);

    // ✅ RESPONSE FORMAT
    const formattedContacts = contacts.map((c) => ({
      type: "contact",
      firstname: c.firstname,
      lastname: c.lastname,
      phoneNumbers: c.phoneNumbers,
      ownerName: `${c.createdByUser?.firstname || ""} ${c.createdByUser?.lastname || ""
        }`,
      ownerEmail: c.createdByUser?.email || "",
      ownerRole: c.createdByUser?.role || "user",
      ownerId: c.createdByUser?._id?.toString() || "",
      contactId: c.contact_id,
    }));

    const formattedLeads = leads.map((l) => ({
      type: "lead",
      firstname: l.firstname,
      lastname: l.lastname,
      phoneNumbers: l.phoneNumbers,
      ownerName: `${l.createdByUser?.firstname || ""} ${l.createdByUser?.lastname || ""
        }`,
      ownerEmail: l.createdByUser?.email || "",
      ownerRole: l.createdByUser?.role || "user",
      ownerId: l.createdByUser?._id?.toString() || "",
      leadId: l.contact_id,
    }));

    return res.status(200).json({
      status: "success",
      message: "Search completed successfully",
      totalResults: formattedContacts.length + formattedLeads.length,
      results: [...formattedContacts, ...formattedLeads],
    });
  } catch (error) {
    console.error("Search Error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal Server Error",
    });
  }
};
