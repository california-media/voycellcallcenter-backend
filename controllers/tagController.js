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
    console.log(contact_id);

    // ✅ Validate category

    if (category && category !== "contact" && category !== "lead") {
      return res.status(400).json({
        status: "error",
        message: "category must be either 'contact' or 'lead' if provided",
      });
    }
    console.log(user_id);

    const Model = category === "lead" ? Lead : Contact;
    console.log(category);

    // ✅ Validate contact
    const contact = await Model.findOne({
      contact_id: new mongoose.Types.ObjectId(contact_id),
      createdBy: user_id,
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

    // ✅ Get user
    const user = await User.findById(user_id);
    if (!user)
      return res
        .status(404)
        .json({ status: "error", message: "User not found" });

    let matchedTags = [];

    let nextContactOrder =
      contact.tags.length > 0
        ? Math.max(...contact.tags.map(t => t.order ?? 0)) + 1
        : 0;

    let nextUserTagOrder =
      user.tags.length > 0
        ? Math.max(...user.tags.map(t => t.order ?? 0)) + 1
        : 0;

    for (const tagItem of tagsArray) {
      const tagText = tagItem.tag?.trim();
      const emoji = tagItem.emoji || "";

      if (!tagText) continue;

      let existingUserTag = user.tags.find(
        (t) => t.tag.toLowerCase() === tagText.toLowerCase()
      );

      // 🆕 CREATE USER TAG
      if (!existingUserTag) {
        existingUserTag = {
          tag_id: new mongoose.Types.ObjectId(),
          tag: tagText,
          emoji,
          order: nextUserTagOrder++,
        };

        user.tags.push(existingUserTag);
        await user.save();
      }

      // 🔁 CHECK CONTACT TAG
      const existingContactTag = contact.tags.find(
        (t) => String(t.tag_id) === String(existingUserTag.tag_id)
      );

      matchedTags.push({
        tag_id: existingUserTag.tag_id,
        tag: existingUserTag.tag,
        emoji: existingUserTag.emoji,

        globalOrder: existingUserTag.order,

        order: existingContactTag
          ? existingContactTag.order
          : nextContactOrder++,
      });
    }

    // for (const tagItem of tagsArray) {
    //   const tagText = tagItem.tag?.trim();
    //   const emoji = tagItem.emoji || "";

    //   if (!tagText) continue;

    //   // 🔍 Check if tag already exists for user
    //   const existingUserTag = user.tags.find(
    //     (t) => t.tag.toLowerCase() === tagText.toLowerCase()
    //   );

    //   let tagObj;

    //   if (existingUserTag) {
    //     tagObj = {
    //       tag_id: existingUserTag.tag_id,
    //       tag: existingUserTag.tag,
    //       emoji: existingUserTag.emoji || null,
    //       order: existingUserTag.order || null,
    //     };
    //   } else {
    //     // 🆕 Create new tag
    //     const newTag = {
    //       tag_id: new mongoose.Types.ObjectId(),
    //       tag: tagText,
    //       emoji,
    //       order: user.tags.length + 1, // assign next order
    //     };
    //     user.tags.push(newTag);
    //     await user.save();

    //     tagObj = {
    //       tag_id: newTag.tag_id,
    //       tag: newTag.tag,
    //       emoji: newTag.emoji || null,
    //       order: newTag.order || null,
    //     };
    //   }

    //   // matchedTags.push(tagObj);
    //   const existingContactTag = contact.tags.find(
    //     (t) => String(t.tag_id) === String(tagObj.tag_id)
    //   );

    //   matchedTags.push({
    //     ...tagObj,
    //     globalOrder: existingUserTag?.order ?? null,
    //     order: existingContactTag
    //       ? existingContactTag.order
    //       : contact.tags.length + matchedTags.length, // 👈 unique per contact
    //   });
    // }

    // ✅ Maintain consistent order with user tags
    // const userTagOrder = user.tags.map((t) => String(t.tag_id));

    // matchedTags.sort((a, b) => {
    //   const indexA = userTagOrder.indexOf(String(a.tag_id));
    //   const indexB = userTagOrder.indexOf(String(b.tag_id));
    //   return indexA - indexB;
    // });

    // // ✅ Add 'order' field to each tag
    // matchedTags = matchedTags.map((t) => ({
    //   ...t,
    //   order: userTagOrder.indexOf(String(t.tag_id)),
    // }));

    // ✅ Save to contact
    contact.tags = matchedTags;
    await logActivityToContact(category, contact._id, {
      action: "tags_updated",
      type: "tag",
      title: "Tags Updated",
      description: `Tags updated to: ${matchedTags.length === 0
        ? "No tags"
        : matchedTags.map((t) => t.tag).join(", ")
        }`,
    });

    await contact.save();

    return res.status(200).json({
      status: "success",
      message: "Tags updated successfully",
      tags: matchedTags,
    });
  } catch (error) {
    console.error("❌ Error updating contact tags:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};

const updateMultipleContactTags = async (req, res) => {
  try {
    const user_id = req.user._id;
    const { contact_id, tags, category } = req.body;

    // ✅ Validate category
    if (!category || !["contact", "lead"].includes(category)) {
      return res.status(400).json({
        status: "error",
        message: "category must be either 'contact' or 'lead'",
      });
    }

    // ✅ Validate contact_id (must be array)
    if (!Array.isArray(contact_id) || contact_id.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "contact_id must be a non-empty array",
      });
    }

    // ✅ Validate tags
    if (!Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "tags must be a non-empty array",
      });
    }

    const Model = category === "lead" ? Lead : Contact;

    // ✅ Fetch user
    const user = await User.findById(user_id);
    if (!user) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    // ===============================
    // 🔖 STEP 1: Ensure tags exist at USER level
    // ===============================

    let nextUserTagOrder =
      user.tags.length > 0
        ? Math.max(...user.tags.map(t => t.order ?? 0)) + 1
        : 0;

    const userTagMap = {}; // tagText(lowercase) => userTag

    for (const tagItem of tags) {
      const tagText = tagItem.tag?.trim();
      const emoji = tagItem.emoji || "";

      if (!tagText) continue;

      let existingUserTag = user.tags.find(
        t => t.tag.toLowerCase() === tagText.toLowerCase()
      );

      if (!existingUserTag) {
        existingUserTag = {
          tag_id: new mongoose.Types.ObjectId(),
          tag: tagText,
          emoji,
          order: nextUserTagOrder++,
        };
        user.tags.push(existingUserTag);
      }

      userTagMap[tagText.toLowerCase()] = existingUserTag;
    }

    await user.save();

    // ===============================
    // 🔁 STEP 2: Apply tags to EACH contact / lead
    // ===============================

    const updatedContacts = [];

    for (const id of contact_id) {
      const contact = await Model.findOne({
        contact_id: new mongoose.Types.ObjectId(id),
        createdBy: user_id,
      });

      if (!contact) continue;

      let nextContactOrder =
        contact.tags.length > 0
          ? Math.max(...contact.tags.map(t => t.order ?? 0)) + 1
          : 0;

      const newTags = [];

      for (const tagItem of tags) {
        const tagText = tagItem.tag?.trim().toLowerCase();
        if (!tagText) continue;

        const userTag = userTagMap[tagText];

        const existingContactTag = contact.tags.find(
          t => String(t.tag_id) === String(userTag.tag_id)
        );

        newTags.push({
          tag_id: userTag.tag_id,
          tag: userTag.tag,
          emoji: userTag.emoji,
          globalOrder: userTag.order,
          order: existingContactTag
            ? existingContactTag.order
            : nextContactOrder++,
        });
      }

      contact.tags = newTags;

      await logActivityToContact(category, contact._id, {
        action: "tags_updated",
        type: "tag",
        title: "Tags Updated",
        description:
          newTags.length === 0
            ? "No tags"
            : `Tags updated to: ${newTags.map(t => t.tag).join(", ")}`,
      });

      await contact.save();
      updatedContacts.push(contact);
    }

    // ===============================
    // ✅ RESPONSE
    // ===============================

    return res.status(200).json({
      status: "success",
      message: "Tags assigned successfully",
      updatedCount: updatedContacts.length,
      contacts: updatedContacts,
    });

  } catch (error) {
    console.error("❌ Error updating contact tags:", error);
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
    console.error("Add Tags Error:", error);
    return res.status(500).json({
      status: "error",
      message: "Error adding tags",
      error: error.message,
    });
  }
};

// try {
//   const user = await User.findById(req.user._id);
//   if (!user) {
//     return res
//       .status(404)
//       .json({ status: "error", message: "User not found" });
//   }
//   const userTags = user.tags.map((tag) => ({
//     tag_id: tag.tag_id,
//     tag: tag.tag,
//     emoji: tag.emoji, // Ensure icon is always present
//     order: tag.order || null,
//   }));

//   res.status(200).json({
//     status: "success",
//     message: "Tags Fetched",
//     data: userTags,
//   });
// } catch {
//   res
//     .status(500)
//     .json({ status: "error", message: "Error fetching the tags" });
// }

const getTags = async (req, res) => {
  try {
    const userId = req.user._id;
    console.log(userId);


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
    console.error("❌ getTags error:", err);
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
    console.error("getTagWithContact error:", err);
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
    console.error("Edit Tag Error:", error);
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
    });

  } catch (error) {
    console.error("DeleteTag Error:", error);
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
