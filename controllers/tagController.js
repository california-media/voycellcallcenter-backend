const mongoose = require("mongoose");
const User = require("../models/userModel");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");

const updateContactTags = async (req, res) => {
    try {
        const user_id = req.user._id;
        const contact_id = req.body.contact_id;
        const { tags } = req.body;

        if (category && category !== "contact" && category !== "lead") {
            return res.status(400).json({
                status: "error",
                message: "category must be either 'contact' or 'lead' if provided",
            });
        }

        // ✅ Validate contact
        const contact = await Contact.findOne({ contact_id: contact_id, createdBy: user_id });
        console.log(contact);

        if (!contact)
            return res.status(404).json({ status: "error", message: "Contact not found" });

        // ✅ Validate and parse tags
        let tagsArray = [];
        if (tags) {
            try {
                tagsArray = typeof tags === "string" ? JSON.parse(tags) : tags;
                if (!Array.isArray(tagsArray)) {
                    return res.status(400).json({
                        status: "error",
                        message: "Tags must be a valid JSON array of objects with tag/emoji",
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
        if (!user) return res.status(404).json({ status: "error", message: "User not found" });

        let matchedTags = [];

        for (const tagItem of tagsArray) {
            const tagText = tagItem.tag?.trim();
            const emoji = tagItem.emoji || "";

            if (!tagText) continue;

            // 🔍 Check if tag already exists for user
            const existingUserTag = user.tags.find(
                (t) => t.tag.toLowerCase() === tagText.toLowerCase()
            );

            let tagObj;

            if (existingUserTag) {
                tagObj = {
                    tag_id: existingUserTag.tag_id,
                    tag: existingUserTag.tag,
                    emoji: existingUserTag.emoji || null,
                };
            } else {
                // 🆕 Create new tag
                const newTag = {
                    tag_id: new mongoose.Types.ObjectId(),
                    tag: tagText,
                    emoji,
                };
                user.tags.push(newTag);
                await user.save();

                tagObj = {
                    tag_id: newTag.tag_id,
                    tag: newTag.tag,
                    emoji: newTag.emoji || null,
                };
            }

            matchedTags.push(tagObj);
        }

        // ✅ Maintain consistent order with user tags
        const userTagOrder = user.tags.map((t) => String(t.tag_id));

        matchedTags.sort((a, b) => {
            const indexA = userTagOrder.indexOf(String(a.tag_id));
            const indexB = userTagOrder.indexOf(String(b.tag_id));
            return indexA - indexB;
        });

        // ✅ Add 'order' field to each tag
        matchedTags = matchedTags.map((t) => ({
            ...t,
            order: userTagOrder.indexOf(String(t.tag_id)),
        }));

        // ✅ Save to contact
        contact.tags = matchedTags;
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

        const existingTagMap = new Map(user.tags.map(t => [t.tag.toLowerCase(), true]));
        const newTags = [];
        const skippedTags = [];

        // Get current highest order value
        let maxOrder = user.tags.length > 0
            ? Math.max(...user.tags.map(t => t.order || 0))
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

const getTags = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res
                .status(404)
                .json({ status: "error", message: "User not found" });
        }
        const userTags = user.tags.map((tag) => ({
            tag_id: tag.tag_id,
            tag: tag.tag,
            emoji: tag.emoji, // Ensure icon is always present
        }));

        res
            .status(200)
            .json({
                status: "success",
                message: "Tags Fetched",
                data: userTags,
            });
    } catch {
        res
            .status(500)
            .json({ status: "error", message: "Error fetching the tags" });
    }
};


const getTagWithContact = async (req, res) => {
    try {
        const { tag_id, order } = req.body; // accept optional params

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({
                status: "error",
                message: "User not found",
            });
        }

        // ========== CASE 1: When tag_id and order are provided (Update order) ==========
        if (tag_id && typeof order === "number") {
            const tagIndex = user.tags.findIndex(
                (t) => t.tag_id.toString() === tag_id
            );
            if (tagIndex === -1) {
                return res.status(404).json({
                    status: "error",
                    message: "Tag not found in user model",
                });
            }

            // Sort existing tags by their current order or index
            user.tags = user.tags.map((t, idx) => ({ ...t.toObject(), order: t.order ?? idx + 1 }));

            // Remove the tag to be reordered
            const [movedTag] = user.tags.splice(tagIndex, 1);

            // If order > tags.length, place at end
            const newOrderPosition =
                order > user.tags.length ? user.tags.length : order - 1;

            // Reinsert tag at new position
            user.tags.splice(newOrderPosition, 0, movedTag);

            // Reassign all orders sequentially
            user.tags = user.tags.map((t, idx) => ({
                ...t,
                order: idx + 1,
            }));

            await user.save();

            // Update all contacts that have this tag with new order
            await Contact.updateMany(
                { createdBy: req.user._id, "tags.tag_id": tag_id },
                { $set: { "tags.$[elem].order": newOrderPosition + 1 } },
                { arrayFilters: [{ "elem.tag_id": new mongoose.Types.ObjectId(tag_id) }] }
            );

            console.log(`Tag ${tag_id} moved to order ${newOrderPosition + 1}`);

            // Fetch updated data again
        }

        // ========== CASE 2: Return all tags with their contacts ==========
        const userTags = user.tags.sort((a, b) => (a.order || 0) - (b.order || 0));

        const tagsWithContacts = await Promise.all(
            userTags.map(async (tag) => {
                const contacts = await Contact.find({
                    createdBy: req.user._id,
                    "tags.tag_id": tag.tag_id,
                }).select(
                    "_id firstname lastname emailaddresses phonenumbers contactImageURL tags.order"
                );

                return {
                    tag_id: tag.tag_id,
                    tag: tag.tag,
                    emoji: tag.emoji,
                    order: tag.order || null,
                    contacts,
                };
            })
        );

        return res.status(200).json({
            status: "success",
            message: tag_id
                ? "Tag order updated and tags fetched successfully"
                : "Tags with contacts fetched successfully",
            data: tagsWithContacts,
        });
    } catch (error) {
        console.error("Error in getTagWithContact:", error);
        return res.status(500).json({
            status: "error",
            message: "Error processing request",
            error: error.message,
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

        const index = user.tags.findIndex(t => t.tag_id.toString() === tag_id);
        if (index === -1) {
            return res.status(404).json({
                status: "error",
                message: "Tag not found",
            });
        }

        user.tags[index].tag = tag.trim();
        user.tags[index].emoji = emoji?.trim() || "";

        await user.save();

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
        const user = await User.findById(req.user._id);
        if (!user) {
            return res
                .status(404)
                .json({ status: "error", message: "User not found" });
        }

        if (!tag_id) {
            return res
                .status(404)
                .json({ status: "error", message: "Tag not found", });
        }
        const tag = user.tags.find((tag) => tag.tag_id.toString() === tag_id);
        if (!tag) {
            return res
                .status(404)
                .json({ status: "error", message: "Tag not found" });
        }

        // // Find the tag object in user.tags by tag_id
        // const tagObject = user.tags.find(
        //   (tag) => tag.tag_id.toString() === tag_id
        // );

        // if (!tagObject) {
        //   return res.status(404).json({
        //     status: "error",
        //     message: "Tag not found in user",
        //   });
        // }

        // const tagName = tagObject.tag; // This is the string stored in contacts

        user.tags.pull({ tag_id });
        await Contact.updateMany(
            { "tags.tag_id": tag_id },
            { $pull: { tags: { tag_id } } }
        );
        await user.save();

        // const contactUpdateResult = await Contact.updateMany(
        //   { tags: tagName },
        //   { $pull: { tags: tagName } }
        // );

        res
            .status(200)
            .json({
                status: "success", message: "Tag Deleted", data: { tag_id }
            });
    } catch {
        res.status(500).send({ status: "error", message: "Error deleting tag" });
    }
};

module.exports = { addTag, updateContactTags, getTags, getTagWithContact, editTag, deleteTag };
