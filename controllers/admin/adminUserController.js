const crypto = require("crypto");
const User = require("../../models/userModel");
const Lead = require("../../models/leadModel");
const mongoose = require("mongoose");
const Contact = require("../../models/contactModel");
const Subscription = require("../../models/Subscription");
const DIDAssignment = require("../../models/DIDAssignment");
const { sendVerificationEmail } = require("../../utils/emailUtils");
const { createTokenforUser } = require("../../services/authentication");
// const { getConfig } = require("../../utils/getConfig");

/**
 * ======================================================
 * ADMIN REGISTER USER API
 * ======================================================
 * Admin creates a user → sends verification email
 */

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const disallowedEmailDomains = [
  // "gmail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "aol.com",
  "mail.com",
  "gmx.com",
  "protonmail.com",
  "zoho.com",
  "yandex.com",
  "tutanota.com",
  "fastmail.com",
  "hushmail.com",
  "inbox.com",
  "lycos.com",
];

exports.adminRegisterUser = async (req, res) => {
  // const {FRONTEND_URL} = getConfig()
  try {
    const { email, firstname = "", lastname = "" } = req.body;

    if (!email) {
      return res.status(400).json({
        status: "error",
        message: "Email is required",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        status: "error",
        message: "User with this email already exists",
      });
    }

    // ── Agent quota check ─────────────────────────────────────────────────────
    const companyAdminId = req.user._id;
    const currentAgentCount = await User.countDocuments({
      createdByWhichCompanyAdmin: companyAdminId,
      role: "user",
      accountStatus: { $ne: "deleted" },
    });

    const activeSubscription = await Subscription.findOne({
      userId: companyAdminId,
      status: { $in: ["active", "trialing"] },
    });

    let allowedAgentCount = 0;
    if (activeSubscription) {
      allowedAgentCount = activeSubscription.agentCount || 1;
    } else {
      // Trial users get 1 free seat
      const admin = await User.findById(companyAdminId).select("planStatus");
      if (admin?.planStatus === "trial") allowedAgentCount = 1;
    }

    // The company admin always occupies 1 seat themselves, so agents can only
    // use the remaining seats: (allowedAgentCount - 1).
    const agentSeatsForAgents = Math.max(0, allowedAgentCount - 1);

    if (currentAgentCount >= agentSeatsForAgents) {
      return res.status(403).json({
        status: "error",
        message: activeSubscription
          ? `You have used all available agent seats. Your plan includes ${allowedAgentCount} seat(s) and 1 is reserved for the company admin account. Please purchase additional seats from the billing page.`
          : "You need an active subscription to add agents. Please upgrade your plan.",
        agentLimitReached: true,
        allowedAgentCount,
        agentSeatsForAgents,
        currentAgentCount,
      });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const emailVerificationToken = crypto.randomBytes(32).toString("hex");
    const createdByWhichCompanyAdmin = companyAdminId;

    const newUser = await User.create({
      email,
      firstname,
      lastname,
      isVerified: false,
      signupMethod: "email",
      role: "user",
      emailVerificationToken,
      isActive: false,
      createdByWhichCompanyAdmin,
    });

    const verificationLink =
      FRONTEND_URL + `/agent-setup?verificationToken=${emailVerificationToken}`;

    await sendVerificationEmail(email, verificationLink);

    return res.status(201).json({
      status: "success",
      message: "User created successfully. Verification email sent.",
      data: {
        _id: newUser._id,
        email: newUser.email,
        verificationLink,
      },
    });
  } catch (error) {
    await User.deleteOne({ email: req.body.email });
    return res.status(500).json({
      status: "error",
      message: "User creation failed",
      error: error.message,
    });
  }
};

exports.getAllUsersByCompanyAdmin = async (req, res) => {
  try {
    // ✅ IMPORTANT: Cast to ObjectId
    const companyAdminId = new mongoose.Types.ObjectId(req.user._id);

    const users = await User.aggregate([
      // 1️⃣ Match agents
      {
        $match: {
          createdByWhichCompanyAdmin: companyAdminId,
          role: "user",
        },
      },

      // 2️⃣ Lookup contacts (Created OR Assigned)
      {
        $lookup: {
          from: "contacts",
          let: { agentId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$createdBy", "$$agentId"] },
                    { $in: ["$$agentId", { $ifNull: ["$assignedTo", []] }] }
                  ]
                }
              }
            },
            { $project: { _id: 1 } } // Only need ID for counting
          ],
          as: "contacts",
        },
      },

      // 3️⃣ Lookup leads (Created OR Assigned)
      {
        $lookup: {
          from: "leads",
          let: { agentId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$createdBy", "$$agentId"] },
                    { $in: ["$$agentId", { $ifNull: ["$assignedTo", []] }] }
                  ]
                }
              }
            },
            { $project: { _id: 1 } } // Only need ID for counting
          ],
          as: "leads",
        },
      },

      // 4️⃣ Add counts
      {
        $addFields: {
          contactCount: { $size: "$contacts" },
          leadCount: { $size: "$leads" },
        },
      },

      // 5️⃣ Remove sensitive + heavy fields
      {
        $project: {
          password: 0,
          salt: 0,
          otp: 0,
          otpExpiresAt: 0,
          resetPasswordToken: 0,
          resetPasswordExpires: 0,
          contacts: 0,
          leads: 0,
        },
      },

      // 6️⃣ Sort
      {
        $sort: { createdAt: -1 },
      },
    ]);

    return res.status(200).json({
      status: "success",
      message: "Agents fetched successfully",
      count: users.length,
      data: users,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: error.message,
    });
  }
};



/**
 * ======================================================
 * EDIT AGENT (UPDATE USER) API
 * ======================================================
 * Update agent's basic information (firstname, lastname, email)
 */
exports.editAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstname, lastname, email, isWaba = false } = req.body;
    const companyAdminId = req.user._id;

    // Find the user and verify ownership
    const user = await User.findOne({
      _id: id,
      createdByWhichCompanyAdmin: companyAdminId,
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message:
          "Agent not found or you don't have permission to edit this agent",
      });
    }

    // Get company admin (needed for WABA assignment)
    const companyAdmin = await User.findOne({
      _id: companyAdminId,
      role: "companyAdmin",
    });

    // If email is being changed, check if new email already exists
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email });
      if (emailExists) {
        return res.status(409).json({
          status: "error",
          message: "Email already exists",
        });
      }

      // Validate email domain if changing email
      const emailDomain = email.split("@")[1]?.toLowerCase();
      if (!emailDomain) {
        return res.status(400).json({
          status: "error",
          message: "Invalid email format",
        });
      }

      if (disallowedEmailDomains.includes(emailDomain)) {
        return res.status(400).json({
          status: "error",
          message: `Email domain ${emailDomain} is not allowed. Please use your company or custom domain email.`,
        });
      }

      user.email = email;
    }

    // Update other fields
    if (firstname !== undefined) user.firstname = firstname;
    if (lastname !== undefined) user.lastname = lastname;

    /* ================================
   WABA Assign / Unassign Logic
=================================*/

    if (typeof isWaba === "boolean") {

      // ASSIGN WABA
      if (isWaba === true) {

        if (!companyAdmin?.whatsappWaba?.isConnected) {
          return res.status(400).json({
            status: "error",
            message: "Company admin has no connected WABA",
          });
        }

        user.whatsappWaba = {
          ...companyAdmin.whatsappWaba.toObject(),
          chats: [],
          isConnected: true,
        };
      }

      // UNASSIGN WABA
      else {
        user.whatsappWaba = {
          isConnected: false,
          wabaId: null,
          phoneNumberId: null,
          businessAccountId: null,
          accessToken: null,
          tokenExpiresAt: null,
          phoneNumber: null,
          displayName: null,
          qualityRating: null,
          messagingLimit: null,
          businessVerificationStatus: null,
          accountReviewStatus: null,
          status: null,
          profile: {},
          webhook: {},
          chats: [],
        };
      }
    }

    await user.save();

    return res.status(200).json({
      status: "success",
      message: "Agent updated successfully",
      data: {
        _id: user._id,
        email: user.email,
        firstname: user.firstname,
        lastname: user.lastname,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Failed to update agent",
      error: error.message,
    });
  }
};
/**
 * ======================================================
 * DELETE AGENT API
 * ======================================================
 * Delete agent and their Yeastar extension
 */
exports.deleteAgent = async (req, res) => {
  try {
    const { id } = req.params;
    const companyAdminId = req.user._id;

    // Find the user and verify ownership
    const user = await User.findOne({
      _id: id,
      createdByWhichCompanyAdmin: companyAdminId,
    });

    if (!user) {
      return res.status(404).json({
        status: "error",
        message:
          "Agent not found or you don't have permission to delete this agent",
      });
    }

    // Delete the user from database
    await User.findByIdAndDelete(id);

    return res.status(200).json({
      status: "success",
      message: "Agent deleted successfully",
      data: {
        _id: user._id,
        email: user.email,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: "Failed to delete agent",
      error: error.message,
    });
  }
};

// PUT /admin/user/:id/caller-numbers
// Company admin assigns specific caller numbers to an agent
// Assign or remove a single number (extension telephone) from an agent
exports.toggleAgentCallerNumber = async (req, res) => {
  try {
    const { id } = req.params;
    const { number, action } = req.body; // action: "add" | "remove"
    const companyAdminId = req.user._id;

    if (!number || !["add", "remove"].includes(action)) {
      return res.status(400).json({ status: "error", message: "number and action (add|remove) are required" });
    }

    const agent = await User.findOne({ _id: id, createdByWhichCompanyAdmin: companyAdminId, role: "user" });
    if (!agent) return res.status(404).json({ status: "error", message: "Agent not found or no permission" });

    if (action === "add") {
      await User.findByIdAndUpdate(id, { $addToSet: { assignedCallerNumbers: String(number).trim() } });
    } else {
      const num = String(number).trim();
      const update = {
        $pull: {
          assignedCallerNumbers: num,
          assignedExtensions: { PBX_TELEPHONE: num }, // always clear from extensions
        },
      };
      // If the removed number is the agent's active top-level telephone, clear PBX fields too
      if (String(agent.telephone).trim() === num) {
        update.$set = { telephone: "", extensionNumber: "", assignedDeviceId: null, status: false };
      }
      await User.findByIdAndUpdate(id, update);
    }

    const updated = await User.findById(id).select("assignedCallerNumbers telephone extensionNumber").lean();
    res.json({ status: "success", assignedCallerNumbers: updated.assignedCallerNumbers });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Failed to update caller number", error: error.message });
  }
};

// PUT /admin/user/reassign-extension
// Move an extension between agent and company admin pool.
// Body: { fromAgentId, toAgentId, extension: { extensionNumber, PBX_TELEPHONE, assignedDeviceId, pbxType, PBX_BASE_URL } }
//   fromAgentId null  → extension currently in admin pool
//   toAgentId   null  → return extension to admin pool
exports.reassignExtension = async (req, res) => {
  try {
    const { fromAgentId, toAgentId, extension } = req.body;
    const companyAdminId = req.user._id;

    const num    = String(extension?.PBX_TELEPHONE || "").trim();
    const extNum = extension?.extensionNumber ? String(extension.extensionNumber).trim() : null;

    if (!num) {
      return res.status(400).json({ status: "error", message: "extension.PBX_TELEPHONE is required" });
    }

    // ── Determine if this is a multi-channel cloud extension ─────────────────
    // Use channels passed from frontend so this works even after admin removes
    // themselves from the extension.
    const passedChannels = parseInt(extension?.channels, 10) || 1;
    const isMultiChannelCloud = passedChannels > 1;

    const adminDoc = await User.findById(companyAdminId).select("assignedExtensions PBXDetails").lean();
    const adminExtEntry = (adminDoc?.assignedExtensions || []).find(
      (e) => (extNum && e.extensionNumber === extNum) || e.PBX_TELEPHONE === num
    );

    // ── Remove from source (agent or company admin) ───────────────────────────
    if (fromAgentId) {
      const fromIdStr  = String(fromAgentId);
      const adminIdStr = String(companyAdminId);

      if (fromIdStr === adminIdStr) {
        // Removing the company admin from this extension.
        // For multichannel: keep entry visible (for superadmin/company views) but mark inactive.
        // For single-channel: remove entirely.
        if (isMultiChannelCloud) {
          await User.findOneAndUpdate(
            { _id: companyAdminId, "assignedExtensions.PBX_TELEPHONE": num },
            { $set: { "assignedExtensions.$.inAdminPool": false } }
          );
          await User.findByIdAndUpdate(companyAdminId, {
            $pull: { assignedCallerNumbers: num },
          });
        } else {
          await User.findByIdAndUpdate(companyAdminId, {
            $pull: {
              assignedCallerNumbers: num,
              assignedExtensions: { PBX_TELEPHONE: num },
            },
          });
        }
      } else {
        const fromAgent = await User.findOne({ _id: fromAgentId, createdByWhichCompanyAdmin: companyAdminId, role: "user" });
        if (!fromAgent) return res.status(404).json({ status: "error", message: "Source agent not found or no permission" });

        const pullUpdate = {
          $pull: {
            assignedCallerNumbers: num,
            assignedExtensions: { PBX_TELEPHONE: num },
          },
        };

        const primaryTel = String(fromAgent.PBXDetails?.PBX_TELEPHONE || "").trim();
        const topTel     = String(fromAgent.telephone || "").trim();
        if (primaryTel === num || topTel === num) {
          pullUpdate.$set = {
            telephone: "",
            extensionNumber: "",
            assignedDeviceId: null,
            extensionStatus: false,
            "PBXDetails.PBX_TELEPHONE": "",
            "PBXDetails.PBX_EXTENSION_NUMBER": "",
            "PBXDetails.PBX_EXTENSION_ID": "",
            "PBXDetails.PBX_SIP_SECRET": "",
            "PBXDetails.assignedDeviceId": null,
          };
        }

        await User.findByIdAndUpdate(fromAgentId, pullUpdate);
      }
    }

    // ── Add to target (agent or company admin) ────────────────────────────────
    if (toAgentId) {
      const toIdStr       = String(toAgentId);
      const adminIdStr    = String(companyAdminId);
      const isAddingAdmin = toIdStr === adminIdStr;

      const toAgent = isAddingAdmin
        ? adminDoc  // already fetched above
        : await User.findOne({ _id: toAgentId, createdByWhichCompanyAdmin: companyAdminId, role: "user" });
      if (!toAgent) return res.status(404).json({ status: "error", message: "Target user not found or no permission" });

      // Channel limit check for multi-channel cloud extensions
      if (isMultiChannelCloud) {
        const maxChannels = passedChannels;
        const agentCount  = await User.countDocuments({
          createdByWhichCompanyAdmin: companyAdminId,
          role: "user",
          $or: [
            extNum ? { "assignedExtensions.extensionNumber": extNum } : null,
            { "assignedExtensions.PBX_TELEPHONE": num },
          ].filter(Boolean),
        });
        // Count admin only if they actively have the extension in their pool
        const adminHasExt = !!adminExtEntry && adminExtEntry.inAdminPool !== false;
        const totalUsed   = agentCount + (adminHasExt ? 1 : 0);
        if (totalUsed >= maxChannels) {
          return res.status(400).json({
            status: "error",
            message: `Channel limit reached. This extension has ${maxChannels} channels. Currently ${totalUsed}/${maxChannels} used.`,
          });
        }
      }

      // Deduplicate: pull any existing entry for this extension first
      await User.findByIdAndUpdate(toAgentId, {
        $pull: {
          assignedExtensions: extNum ? { extensionNumber: extNum } : { PBX_TELEPHONE: num },
          assignedCallerNumbers: num,
        },
      });

      // If the extension entry has no assignedDeviceId (e.g. corrupted by old buildExtList
      // saving PBXDetails with null deviceId), fall back to the admin's PBXDetails deviceId
      // for the same extension so the Yeastar signature controller can find the device.
      let resolvedDeviceId = extension?.assignedDeviceId || null;
      let resolvedBaseUrl  = extension?.PBX_BASE_URL     || null;
      if (!resolvedDeviceId) {
        const adminDoc = await User.findById(companyAdminId).select("PBXDetails").lean();
        const adminExtNum = adminDoc?.PBXDetails?.PBX_EXTENSION_NUMBER;
        const adminTel    = adminDoc?.PBXDetails?.PBX_TELEPHONE;
        if ((extNum && adminExtNum === extNum) || adminTel === num) {
          resolvedDeviceId = adminDoc.PBXDetails.assignedDeviceId || null;
          resolvedBaseUrl  = resolvedBaseUrl || adminDoc.PBXDetails.PBX_BASE_URL || null;
        }
      }

      const extEntry = {
        extensionNumber:  extNum || "",
        PBX_TELEPHONE:    num,
        PBX_BASE_URL:     resolvedBaseUrl,
        assignedDeviceId: resolvedDeviceId,
        pbxType:          extension?.pbxType || "cloud",
        channels:         passedChannels,
      };

      const setOnAgent = isAddingAdmin ? {} : { extensionStatus: true };
      // If agent has no primary PBXDetails extension, promote this one so the
      // Yeastar login controller and FloatingDialer init can find it.
      if (!isAddingAdmin && !toAgent.PBXDetails?.PBX_EXTENSION_NUMBER) {
        setOnAgent["PBXDetails.PBX_EXTENSION_NUMBER"] = extNum || "";
        setOnAgent["PBXDetails.PBX_TELEPHONE"]        = num;
        setOnAgent["PBXDetails.assignedDeviceId"]     = resolvedDeviceId;
        if (resolvedBaseUrl) setOnAgent["PBXDetails.PBX_BASE_URL"] = resolvedBaseUrl;
        // Top-level fields — FloatingDialer init reads extensionNumber directly
        setOnAgent.extensionNumber = extNum || "";
        setOnAgent.telephone       = num;
      }

      await User.findByIdAndUpdate(toAgentId, {
        $push:     { assignedExtensions: extEntry },
        $addToSet: { assignedCallerNumbers: num },
        $set:      setOnAgent,
      });
    }

    // ── Return to admin pool ──────────────────────────────────────────────────
    // Single-channel: always return when no target.
    // Multichannel: return only when an AGENT (not admin) is the source — ensures ext stays
    // visible in the table after all channels are freed; admin self-removal stays excluded.
    const fromIsAgent = fromAgentId && String(fromAgentId) !== String(companyAdminId);
    if (!toAgentId && (!isMultiChannelCloud || fromIsAgent)) {
      const admin = await User.findById(companyAdminId).select("assignedExtensions").lean();
      const existingPoolEntry = (admin?.assignedExtensions || []).find(
        (e) => (extNum && e.extensionNumber === extNum) || e.PBX_TELEPHONE === num
      );
      if (!existingPoolEntry) {
        await User.findByIdAndUpdate(companyAdminId, {
          $push: {
            assignedExtensions: {
              extensionNumber:  extNum || "",
              PBX_TELEPHONE:    num,
              PBX_BASE_URL:     extension?.PBX_BASE_URL     || null,
              assignedDeviceId: extension?.assignedDeviceId || null,
              pbxType:          extension?.pbxType          || "cloud",
              channels:         passedChannels,
            },
          },
        });
      } else if (existingPoolEntry.inAdminPool === false) {
        // Ext was removed from admin pool — re-enable it
        await User.findOneAndUpdate(
          { _id: companyAdminId, "assignedExtensions.PBX_TELEPHONE": num },
          { $set: { "assignedExtensions.$.inAdminPool": true } }
        );
      }
      // Clean up any accidental assignedCallerNumbers entry for multichannel ext.
      // assignedCallerNumbers on admin is a restriction list — should not contain ext telephones.
      if (isMultiChannelCloud) {
        await User.findByIdAndUpdate(companyAdminId, {
          $pull: { assignedCallerNumbers: num },
        });
      }
    }

    // ── Remove from admin pool when assigning to agent from pool ─────────────
    // Skip: multichannel (admin keeps their channel), or when admin is the target (no self-pull).
    if (toAgentId && !fromAgentId && !isMultiChannelCloud && String(toAgentId) !== String(companyAdminId)) {
      const adminDoc = await User.findById(companyAdminId).select("PBXDetails").lean();
      const adminPrimaryExtNum = adminDoc?.PBXDetails?.PBX_EXTENSION_NUMBER;
      const adminPrimaryTel    = adminDoc?.PBXDetails?.PBX_TELEPHONE;
      const isAdminPrimary = (extNum && adminPrimaryExtNum === extNum) || adminPrimaryTel === num;

      const adminUpdate = {
        $pull: {
          assignedExtensions: extNum ? { extensionNumber: extNum } : { PBX_TELEPHONE: num },
        },
      };
      if (isAdminPrimary) {
        // Extension was also the admin's own primary — clear PBXDetails so superadmin UI
        // doesn't show it under the admin after it has been handed off to the agent.
        adminUpdate.$set = {
          "PBXDetails.PBX_EXTENSION_NUMBER": "",
          "PBXDetails.PBX_TELEPHONE":        "",
          "PBXDetails.assignedDeviceId":     null,
        };
      }
      await User.findByIdAndUpdate(companyAdminId, adminUpdate);
    }

    res.json({ status: "success" });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Failed to reassign extension", error: error.message });
  }
};

exports.assignAgentCallerNumbers = async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedCallerNumbers } = req.body; // string[]
    const companyAdminId = req.user._id;

    if (!Array.isArray(assignedCallerNumbers)) {
      return res.status(400).json({ status: "error", message: "assignedCallerNumbers must be an array" });
    }

    const agent = await User.findOne({ _id: id, createdByWhichCompanyAdmin: companyAdminId, role: "user" });
    if (!agent) {
      return res.status(404).json({ status: "error", message: "Agent not found or no permission" });
    }

    const cleaned = assignedCallerNumbers.map((n) => String(n).trim()).filter(Boolean);
    const previouslyAssigned = (agent.assignedCallerNumbers || []).map(String);

    // Numbers being released back to admin pool
    const toRelease = previouslyAssigned.filter((n) => !cleaned.includes(n));
    // Numbers being newly assigned to this agent (must be unassigned or already owned by this agent)
    const toAssign = cleaned.filter((n) => !previouslyAssigned.includes(n));

    if (toRelease.length > 0) {
      await DIDAssignment.updateMany(
        { number: { $in: toRelease }, companyAdminId, assignedAgentId: new mongoose.Types.ObjectId(id) },
        { $set: { assignedAgentId: null, assignedAgentAt: null } }
      );
    }

    if (toAssign.length > 0) {
      // Only assign numbers that are free (not already given to another agent)
      await DIDAssignment.updateMany(
        { number: { $in: toAssign }, companyAdminId, $or: [{ assignedAgentId: null }, { assignedAgentId: new mongoose.Types.ObjectId(id) }] },
        { $set: { assignedAgentId: new mongoose.Types.ObjectId(id), assignedAgentAt: new Date() } }
      );
    }

    agent.assignedCallerNumbers = cleaned;
    await agent.save();

    res.json({ status: "success", assignedCallerNumbers: agent.assignedCallerNumbers });
  } catch (error) {
    res.status(500).json({ status: "error", message: "Failed to update caller numbers", error: error.message });
  }
};
