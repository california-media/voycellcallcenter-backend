const Contact = require("../models/contactModel");

exports.getAllContactsOrLeads = async (req, res) => {
  try {
    const {
      isLead = false,
      page = 1,
      limit = 10,
      search = "",
      tag = "",
      sorted = false,
      isFavourite = false,
    } = req.body;

    const createdBy = req.user._id;

    // -------------------------------
    // 🔍 Build Base Query
    // -------------------------------
    const query = { createdBy, isLead };

    // Filter by favourite
    if (isFavourite === true || isFavourite === "true") {
      query.isFavourite = true;
    }

    // -------------------------------
    // 🔍 Search Filter (case-insensitive)
    // -------------------------------
    if (search?.trim()) {
      const searchText = search.trim();
      const regex = new RegExp(searchText, "i"); // Case-insensitive regex

      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { emailAddresses: { $elemMatch: { $regex: regex } } },
        {
          phonenumbers: {
            $elemMatch: { number: { $regex: regex } }, // partial number search
          },
        },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ["$firstName", " ", "$lastName"] },
              regex: searchText, // plain string here, not RegExp
            },
          },
        },
      ];
    }

    // -------------------------------
    // 🏷️ Tag Filter
    // -------------------------------
    if (Array.isArray(tag) && tag.length > 0) {
      query["tags.tag"] = { $in: tag.map((t) => new RegExp(`^${t}$`, "i")) };
    } else if (typeof tag === "string" && tag.trim() !== "") {
      query["tags.tag"] = { $regex: `^${tag.trim()}$`, $options: "i" };
    }

    // -------------------------------
    // 📊 Pagination
    // -------------------------------
    const totalCount = await Contact.countDocuments(query);
    const totalPages = Math.ceil(totalCount / limit);
    const skip = (page - 1) * limit;

    // -------------------------------
    // 📋 Fetch Data
    // -------------------------------
    const items = await Contact.find(query)
      .sort(sorted ? { firstName: 1, lastName: 1 } : { createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select("-updatedAt -__v")
      .lean();

    // -------------------------------
    // 🧹 Clean Data
    // -------------------------------
    const data = items.map((item) => {
      // Normalize phone numbers
      item.phoneNumbers = Array.isArray(item.phonenumbers)
        ? item.phonenumbers.filter(
            (p) =>
              (p?.number && p.number.trim()) ||
              (p?.countryCode && p.countryCode.trim())
          )
        : [];

      // Normalize tags
      item.tags = Array.isArray(item.tags)
        ? item.tags.map((t) => ({
            tag: t.tag,
            emoji: t.emoji || "",
          }))
        : [];

      item.contact_id = item._id?.toString();
      return item;
    });

    // -------------------------------
    // ✅ Response
    // -------------------------------
    res.status(200).json({
      status: "success",
      message: isLead
        ? "Leads fetched successfully"
        : "Contacts fetched successfully",
      data,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: totalCount,
      },
    });
  } catch (error) {
    console.error("Error fetching contacts/leads:", error);
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};
