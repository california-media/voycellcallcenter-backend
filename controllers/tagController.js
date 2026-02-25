const mongoose = require("mongoose");
const User = require("../models/userModel");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const { logActivityToContact } = require("../utils/activityLogger"); // ✅ import activity logger

const updateContactTags = async (req, res) => {
  try {
    const user_id = req.user._id;
    const contact_id = req.body.contact_id;
    const { tags } = req.body;
    const category = req.body.category;

    // ✅ Validate category

    if (category && category !== "contact" && category !== "lead") {
      return res.status(400).json({
        status: "error",
        message: "category must be either 'contact' or 'lead' if provided",
      });
    }

    // ✅ Get user
    const user = await User.findById(user_id);
    if (!user)
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });

    let allowedCreatedByIds = [user_id];

    if (user.role === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: user_id,
        role: "user",
      }).select("_id");

      allowedCreatedByIds.push(...agents.map(a => a._id));
    }

    const Model = category === "lead" ? Lead : Contact;

    // ✅ Validate contact
    const contact = await Model.findOne({
      contact_id: new mongoose.Types.ObjectId(contact_id),
      // createdBy: user_id,
      createdBy: { $in: allowedCreatedByIds },
    });

    if (!contact)
      return res
        .status(404)
        .json({ status: "error", message: "Contact not found" });

    // ✅ Validate and parse tags
    let tagsArray = [];
    if (tags) {
      try {
        tagsArray = typeof tags === "string" ? JSON.parse(tags) : tags;
        if (!Array.isArray(tagsArray)) {
          return res.status(400).json({
            status: "error",
            message:
              "Tags must be a valid JSON array of objects with tag/emoji",
          });
        }
      } catch (err) {
        return res.status(400).json({
          status: "error",
          message: "Tags must be valid JSON array format",
        });
      }
    } else {
      return res.status(400).json({
        status: "error",
        message: "Tags are required",
      });
    }



    let matchedTags = [];

    let nextUserTagOrder =
      user.tags.length > 0
        ? Math.max(...user.tags.map(t => t.order ?? 0)) + 1
        : 0;

    // ------------------------------------------------------------------
    // PROCESS INCOMING TAGS (DEDUPLICATE)
    // ------------------------------------------------------------------
    const processedTags = [];
    const seenNames = new Set();
    let userTagsUpdated = false;

    for (const tagItem of tagsArray) {
      const tagText = tagItem.tag?.trim();
      if (!tagText) continue;

      const normalizedName = tagText.toLowerCase();
      if (seenNames.has(normalizedName)) continue;
      seenNames.add(normalizedName);

      const emoji = tagItem.emoji || "🏷️";

      let existingUserTag = user.tags.find(
        (t) => t.tag.toLowerCase() === normalizedName
      );

      // Create tag in User profile if missing
      if (!existingUserTag) {
        existingUserTag = {
          tag_id: new mongoose.Types.ObjectId(),
          tag: tagText,
          emoji,
          order: nextUserTagOrder++,
        };
        user.tags.push(existingUserTag);
        userTagsUpdated = true;
      }
      processedTags.push(existingUserTag);
    }

    if (userTagsUpdated) {
      await user.save();
    }

    // ------------------------------------------------------------------
    // MERGE WITH EXISTING CONTACT TAGS (PRESERVE OTHER USERS' TAGS)
    // ------------------------------------------------------------------
    const myTagIdStrings = user.tags.map(t => t.tag_id.toString());

    // Tags that belong to OTHER users (not in current user's tag list)
    const otherUsersTags = contact.tags.filter(
      t => !t.tag_id || !myTagIdStrings.includes(t.tag_id.toString())
    );

    let nextContactOrder =
      contact.tags.length > 0
        ? Math.max(...contact.tags.map(t => t.order ?? 0)) + 1
        : 0;

    const myNewContactTags = processedTags.map(ut => {
      // Check if this tag already exists on the contact to preserve its local order
      const existingOnContact = contact.tags.find(
        t => String(t.tag_id) === String(ut.tag_id)
      );

      return {
        tag_id: ut.tag_id,
        tag: ut.tag,
        emoji: ut.emoji,
        globalOrder: ut.order,
        order: existingOnContact ? existingOnContact.order : nextContactOrder++,
      };
    });

    // Final combined list
    const finalContactTags = [...otherUsersTags, ...myNewContactTags];

    // ✅ Save to contact
    contact.tags = finalContactTags;
    await logActivityToContact(category, contact._id, {
      action: "tags_updated",
      type: "tag",
      title: "Tags Updated",
      description: `Tags updated to: ${myNewContactTags.length === 0
        ? "No tags"
        : myNewContactTags.map((t) => t.tag).join(", ")
        }`,
    });

    await contact.save();

    return res.status(200).json({
      status: "success",
      message: "Tags updated successfully",
      tags: matchedTags,
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

const updateMultipleContactTags = async (req, res) => {
  try {
    const loginUserId = req.user._id;
    const { contact_id = [], tags = [], category } = req.body;

    // ===============================
    // ✅ VALIDATIONS
    // ===============================
    if (!["contact", "lead"].includes(category)) {
      return res.status(400).json({
        status: "error",
        message: "category must be contact or lead",
      });
    }

    if (!Array.isArray(contact_id) || contact_id.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "contact_id must be a non-empty array",
      });
    }

    if (!Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "tags must be a non-empty array",
      });
    }

    const Model = category === "lead" ? Lead : Contact;

    // ===============================
    // 👤 FETCH LOGIN USER
    // ===============================
    const loginUser = await User.findById(loginUserId);
    if (!loginUser) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // ===============================
    // 🔐 ALLOWED CREATED BY IDS
    // ===============================
    let allowedCreatedByIds = [loginUserId];

    if (loginUser.role === "companyAdmin") {
      const agents = await User.find({
        createdByWhichCompanyAdmin: loginUserId,
        role: "user",
      }).select("_id");

      allowedCreatedByIds.push(...agents.map(a => a._id));
    }

    // ===============================
    // 🔖 STEP 1: ENSURE TAGS EXIST IN USER MODEL
    // ===============================
    let nextUserTagOrder =
      loginUser.tags.length > 0
        ? Math.max(...loginUser.tags.map(t => t.order ?? 0)) + 1
        : 0;

    const userTagMap = {}; // lowercase tag => userTag

    const uniqueIncomingTags = [];
    const seenNamesInRequest = new Set();
    for (const t of tags) {
      const name = t.tag?.trim();
      if (!name) continue;
      const lowerName = name.toLowerCase();
      if (!seenNamesInRequest.has(lowerName)) {
        seenNamesInRequest.add(lowerName);
        uniqueIncomingTags.push(t);
      }
    }

    for (const tagItem of uniqueIncomingTags) {
      const tagText = tagItem.tag?.trim();
      if (!tagText) continue;

      const emoji = tagItem.emoji || "🏷️";

      let existingUserTag = loginUser.tags.find(
        t => t.tag.toLowerCase() === tagText.toLowerCase()
      );

      if (!existingUserTag) {
        existingUserTag = {
          tag_id: new mongoose.Types.ObjectId(),
          tag: tagText,
          emoji,
          order: nextUserTagOrder++,
        };
        loginUser.tags.push(existingUserTag);
      }

      userTagMap[tagText.toLowerCase()] = existingUserTag;
    }

    await loginUser.save();

    // ===============================
    // 🔁 STEP 2: APPLY TAGS TO CONTACTS / LEADS (OPTIMIZED)
    // ===============================
    let updatedCount = 0;
    const batchSize = 10000;

    for (let i = 0; i < contact_id.length; i += batchSize) {
      const batchIds = contact_id.slice(i, i + batchSize);

      // Fetch contacts for this batch
      const docs = await Model.find({
        contact_id: { $in: batchIds.map(id => new mongoose.Types.ObjectId(id)) },
        createdBy: { $in: allowedCreatedByIds }
      }).select("tags _id contact_id");

      const bulkOps = [];

      for (const doc of docs) {
        const newTagsToAdd = [];
        let nextContactOrder =
          doc.tags.length > 0
            ? Math.max(...doc.tags.map(t => t.order ?? 0)) + 1
            : 0;

        for (const tagItem of uniqueIncomingTags) {
          const tagKey = tagItem.tag?.trim().toLowerCase();
          if (!tagKey) continue;

          const userTag = userTagMap[tagKey];
          if (!userTag) continue;

          const alreadyExists = doc.tags.find(
            t => String(t.tag_id) === String(userTag.tag_id)
          );

          if (!alreadyExists) {
            newTagsToAdd.push({
              tag_id: userTag.tag_id,
              tag: userTag.tag,
              emoji: userTag.emoji,
              globalOrder: userTag.order,
              order: nextContactOrder++,
            });
          }
        }

        if (newTagsToAdd.length > 0) {
          const activityObj = {
            action: "tags_added",
            type: "tag",
            title: "Tags Added",
            description: `Tags added: ${newTagsToAdd.map(t => t.tag).join(", ")}`,
            timestamp: new Date()
          };

          bulkOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $push: {
                  tags: { $each: newTagsToAdd },
                  activities: activityObj
                }
              }
            }
          });
          updatedCount++;
        }
      }

      if (bulkOps.length > 0) {
        await Model.bulkWrite(bulkOps);
      }
    }

    // ===============================
    // ✅ RESPONSE
    // ===============================
    return res.status(200).json({
      status: "success",
      message: "Tags assigned successfully",
      updatedCount,
    });

  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

const addTag = async (req, res) => {
  try {
    const tagsArray = req.body;

    if (!Array.isArray(tagsArray) || tagsArray.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Please provide an array of tags",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    const existingTagMap = new Map(
      user.tags.map((t) => [t.tag.toLowerCase(), true])
    );
    const newTags = [];
    const skippedTags = [];

    // Get current highest order value
    let maxOrder =
      user.tags.length > 0
        ? Math.max(...user.tags.map((t) => t.order || 0))
        : 0;

    for (const item of tagsArray) {
      const tagText = item.tag?.trim();
      const emoji = item.emoji?.trim() || "";

      if (!tagText) continue;

      const lowerTagText = tagText.toLowerCase();
      if (existingTagMap.has(lowerTagText)) {
        skippedTags.push(lowerTagText);
        continue;
      }

      maxOrder++; // increment order

      const newTag = {
        tag_id: new mongoose.Types.ObjectId(),
        tag: tagText,
        emoji,
        order: maxOrder,
      };

      user.tags.push(newTag);
      newTags.push(newTag);
    }

    await user.save();

    return res.status(200).json({
      status: "success",
      message: "Tags Added",
      data: newTags,
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Error adding tags",
      error: error.message,
    });
  }
};

const getTags = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // ---------------- CONTACT COUNTS ----------------
    const contactCounts = await Contact.aggregate([
      {
        $match: {
          tags: { $exists: true, $ne: [] },
        },
      },
      { $unwind: "$tags" },
      {
        $group: {
          _id: { $toString: "$tags.tag_id" },
          count: { $sum: 1 },
        },
      },
    ]);

    // ---------------- LEAD COUNTS ----------------
    const leadCounts = await Lead.aggregate([
      {
        $match: {
          tags: { $exists: true, $ne: [] },
        },
      },
      { $unwind: "$tags" },
      {
        $group: {
          _id: { $toString: "$tags.tag_id" },
          count: { $sum: 1 },
        },
      },
    ]);

    // ---------------- MAP COUNTS ----------------
    const contactCountMap = {};
    contactCounts.forEach((c) => {
      contactCountMap[c._id] = c.count;
    });

    const leadCountMap = {};
    leadCounts.forEach((l) => {
      leadCountMap[l._id] = l.count;
    });

    // ---------------- FINAL RESPONSE ----------------
    const tagsWithCounts = user.tags.map((tag) => {
      const tagId = tag.tag_id.toString();

      const contactCount = contactCountMap[tagId] || 0;
      const leadCount = leadCountMap[tagId] || 0;

      return {
        tag_id: tag.tag_id,
        tag: tag.tag,
        emoji: tag.emoji,
        order: tag.order ?? null,
        contactCount,
        leadCount,
        totalCount: contactCount + leadCount,
      };
    });

    res.status(200).json({
      status: "success",
      message: "Tags fetched with counts",
      data: tagsWithCounts,
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Error fetching tags",
    });
  }
};

const getTagWithContact = async (req, res) => {
  try {
    const { tag_id } = req.body;
    const order = Number(req.body.order); // 🔥 FIX #1

    let user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // ================= UPDATE TAG ORDER =================
    if (tag_id && !Number.isNaN(order)) {
      // Normalize existing order
      user.tags = user.tags
        .map((t, i) => ({
          ...t.toObject(),
          order: typeof t.order === "number" ? t.order : i + 1,
        }))
        .sort((a, b) => a.order - b.order);

      const index = user.tags.findIndex(
        t => t.tag_id.toString() === tag_id
      );

      if (index === -1) {
        return res.status(404).json({
          status: "error",
          message: "Tag not found",
        });
      }

      const [movedTag] = user.tags.splice(index, 1);

      const newIndex = Math.max(
        0,
        Math.min(order - 1, user.tags.length)
      );

      user.tags.splice(newIndex, 0, movedTag);

      // Reassign global order
      user.tags = user.tags.map((t, i) => ({
        ...t,
        order: i + 1,
      }));

      await user.save();

      // 🔁 Sync ONLY globalOrder to contacts & leads
      const bulkOps = user.tags.map(t => ({
        updateMany: {
          filter: {
            createdBy: req.user._id,
            "tags.tag_id": t.tag_id,
          },
          update: {
            $set: {
              "tags.$[elem].globalOrder": t.order,
            },
          },
          arrayFilters: [
            { "elem.tag_id": t.tag_id },
          ],
        },
      }));

      await Contact.bulkWrite(bulkOps);
      await Lead.bulkWrite(bulkOps);

      user = await User.findById(req.user._id).lean();
    }

    // ================= FETCH TAGS WITH CONTACTS =================
    const userTags = [...user.tags].sort((a, b) => a.order - b.order);

    const data = await Promise.all(
      userTags.map(async tag => {
        const contacts = await Contact.find({
          createdBy: req.user._id,
          "tags.tag_id": tag.tag_id,
        }).select({
          firstname: 1,
          lastname: 1,
          emailAddresses: 1,
          phoneNumbers: 1,
          contactImageURL: 1,
          tags: { $elemMatch: { tag_id: tag.tag_id } },
        });

        const leads = await Lead.find({
          createdBy: req.user._id,
          "tags.tag_id": tag.tag_id,
        }).select({
          firstname: 1,
          lastname: 1,
          emailAddresses: 1,
          phoneNumbers: 1,
          leadImageURL: 1,
          tags: { $elemMatch: { tag_id: tag.tag_id } },
        });

        return {
          tag_id: tag.tag_id,
          tag: tag.tag,
          emoji: tag.emoji,
          order: tag.order,
          contacts,
          leads,
        };
      })
    );

    return res.json({
      status: "success",
      message: "Tags fetched successfully",
      data,
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
};

const editTag = async (req, res) => {
  try {
    const { tag_id, tag, emoji } = req.body;

    if (!tag_id || !tag?.trim()) {
      return res.status(400).json({
        status: "error",
        message: "Please provide tag_id and tag text",
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    const index = user.tags.findIndex((t) => t.tag_id.toString() === tag_id);
    if (index === -1) {
      return res.status(404).json({
        status: "error",
        message: "Tag not found",
      });
    }

    user.tags[index].tag = tag.trim();
    user.tags[index].emoji = emoji?.trim() || "";

    await user.save();

    await Contact.updateMany(
      {
        createdBy: req.user._id,
        "tags.tag_id": tag_id,
      },
      {
        $set: {
          "tags.$[t].tag": tag.trim(),
          "tags.$[t].emoji": emoji?.trim() || "",
        },
      },
      {
        arrayFilters: [{ "t.tag_id": tag_id }],
      }
    );

    await Lead.updateMany(
      {
        createdBy: req.user._id,
        "tags.tag_id": tag_id,
      },
      {
        $set: {
          "tags.$[t].tag": tag.trim(),
          "tags.$[t].emoji": emoji?.trim() || "",
        },
      },
      {
        arrayFilters: [{ "t.tag_id": tag_id }],
      }
    );

    return res.status(200).json({
      status: "success",
      message: "Tag Updated",
      data: [user.tags[index]],
    });
  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Error editing tag",
      error: error.message,
    });
  }
};

const deleteTag = async (req, res) => {
  try {
    const { tag_id } = req.body;
    if (!tag_id) {
      return res.status(400).json({ status: "error", message: "tag_id required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ status: "error", message: "User not found" });
    }

    // 1️⃣ Remove tag from USER
    const removedIndex = user.tags.findIndex(
      t => t.tag_id.toString() === tag_id
    );

    if (removedIndex === -1) {
      return res.status(404).json({ status: "error", message: "Tag not found" });
    }

    user.tags.splice(removedIndex, 1);

    // 2️⃣ Reorder USER tags
    user.tags = user.tags
      .sort((a, b) => a.order - b.order)
      .map((t, index) => ({
        ...t.toObject(),
        order: index + 1,
      }));

    await user.save();

    // 3️⃣ Build GLOBAL ORDER MAP (🔥 MOST IMPORTANT PART)
    const globalOrderMap = {};
    user.tags.forEach(t => {
      globalOrderMap[t.tag_id.toString()] = t.order;
    });

    // 4️⃣ Update CONTACTS
    const contacts = await Contact.find({ createdBy: user._id });

    for (const contact of contacts) {
      let changed = false;

      contact.tags = contact.tags
        .filter(t => {
          if (t.tag_id.toString() === tag_id) {
            changed = true;
            return false; // remove deleted tag
          }
          return true;
        })
        .map(t => {
          const newGlobalOrder = globalOrderMap[t.tag_id.toString()];
          if (newGlobalOrder && t.globalOrder !== newGlobalOrder) {
            changed = true;
            return { ...t.toObject(), globalOrder: newGlobalOrder };
          }
          return t;
        });

      if (changed) {
        // optional: reorder local order
        contact.tags = contact.tags
          .sort((a, b) => a.order - b.order)
          .map((t, i) => ({ ...t, order: i + 1 }));

        await contact.save();
      }
    }

    // 5️⃣ Update LEADS
    const leads = await Lead.find({ createdBy: user._id });

    for (const lead of leads) {
      let changed = false;

      lead.tags = lead.tags
        .filter(t => {
          if (t.tag_id.toString() === tag_id) {
            changed = true;
            return false;
          }
          return true;
        })
        .map(t => {
          const newGlobalOrder = globalOrderMap[t.tag_id.toString()];
          if (newGlobalOrder && t.globalOrder !== newGlobalOrder) {
            changed = true;
            return { ...t.toObject(), globalOrder: newGlobalOrder };
          }
          return t;
        });

      if (changed) {
        lead.tags = lead.tags
          .sort((a, b) => a.order - b.order)
          .map((t, i) => ({ ...t, order: i + 1 }));

        await lead.save();
      }
    }

    return res.status(200).json({
      status: "success",
      message: "Tag deleted",
      data: {
        tag_id,
      }
    });

  } catch (error) {
    return res.status(500).json({
      status: "error",
      message: "Delete tag failed",
      error: error.message,
    });
  }
};

module.exports = {
  addTag,
  updateContactTags,
  updateMultipleContactTags,
  getTags,
  getTagWithContact,
  editTag,
  deleteTag,
};
