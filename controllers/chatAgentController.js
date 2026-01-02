const OpenAI = require("openai");
const User = require("../models/userModel");
const Contact = require("../models/contactModel");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ================================
   🔍 INTENT DETECTOR
================================ */
function detectContactIntent(message) {
  const text = message.toLowerCase();

  if (text.includes("show") && text.includes("contact")) return "LIST_CONTACTS";

  if (text.includes("how many") && text.includes("contact"))
    return "COUNT_CONTACTS";

  if (
    text.includes("number of") ||
    text.includes("phone of") ||
    text.includes("contact of")
  )
    return "GET_CONTACT_NUMBER";

  return "AI_CHAT";
}

/* ================================
   🧠 USER CONTEXT BUILDER
================================ */
function buildUserContext(user) {
  return `
USER PROFILE
------------
Name: ${user.firstname || ""} ${user.lastname || ""}
Gender: ${user.gender || "not specified"}
Email: ${user.email || "not provided"}
Role: ${user.role}
Account Status: ${user.accountStatus}
Is Verified: ${user.isVerified}
Signup Method: ${user.signupMethod}
Agent Status: ${user.agentStatus}
Last Seen: ${user.lastSeen || "N/A"}

BUSINESS INFO
-------------
Company Name: ${user.userInfo?.companyName || ""}
Goals: ${user.userInfo?.goals || ""}
Categories: ${user.userInfo?.categories || ""}
Employee Count: ${user.userInfo?.employeeCount || ""}

INSTRUCTIONS
------------
- Use this data to personalize answers
- Do NOT expose internal IDs or secrets
- Be concise and helpful
`;
}

/* ================================
   🚀 MAIN CONTROLLER
================================ */
exports.chatAgent = async (req, res) => {
  console.log("🚀 chatAgent START");
  console.log("📥 Request body:", req.body);
  console.log("👤 User:", req.user?._id || "NOT LOGGED IN");

  try {
    /* ================================
       ✅ VALIDATION
    ================================ */
    const { message } = req.body;

    if (!message) {
      console.log("❌ Validation failed: message missing");
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    /* ================================
       🧠 INTENT DETECTION
    ================================ */
    const intent = detectContactIntent(message);
    console.log("🧠 Detected intent:", intent);

    /* ================================
       🚫 AUTH GUARD
    ================================ */
    if (!req.user?._id && intent !== "AI_CHAT") {
      console.log("⛔ Blocked: Contact intent without login");
      return res.json({
        success: false,
        reply: "Please log in to access your contacts.",
      });
    }

    /* ================================
       📒 LIST CONTACTS
    ================================ */
    if (intent === "LIST_CONTACTS") {
      console.log("📒 LIST_CONTACTS start");

      const contacts = await Contact.find({
        createdBy: req.user._id,
      })
        .select("name phone email")
        .lean();

      console.log("📒 Contacts found:", contacts.length);

      return res.json({
        success: true,
        contacts,
      });
    }

    /* ================================
       🔢 COUNT CONTACTS
    ================================ */
    if (intent === "COUNT_CONTACTS") {
      console.log("🔢 COUNT_CONTACTS start");

      const count = await Contact.countDocuments({
        createdBy: req.user._id,
      });

      console.log("🔢 Contact count:", count);

      return res.json({
        success: true,
        reply: `You have ${count} contacts.`,
      });
    }

    /* ================================
       📞 GET CONTACT NUMBER
    ================================ */
    if (intent === "GET_CONTACT_NUMBER") {
      console.log("📞 GET_CONTACT_NUMBER start");

      const name = message.split("of")[1]?.trim();
      console.log("📞 Parsed name:", name);

      if (!name) {
        console.log("⚠️ No contact name provided");
        return res.json({
          success: false,
          reply: "Please specify the contact name.",
        });
      }

      const contact = await Contact.findOne({
        createdBy: req.user._id,
        $or: [
          { firstname: { $regex: name, $options: "i" } },
          { lastname: { $regex: name, $options: "i" } },
        ],
      })
        .select("firstname lastname phoneNumbers emailAddresses")
        .lean();

      console.log("📞 Contact found:", !!contact);

      if (!contact) {
        return res.json({
          success: false,
          reply: `I couldn't find a contact named ${name}.`,
        });
      }
      console.log(contact, "jkhgfchvjb");

      return res.json({
        success: true,
        reply: `${contact.firstname}${" "}${
          contact.lastname
        }'s phone number is ${
          contact.phoneNumbers && contact.phoneNumbers.length > 0
            ? contact.phoneNumbers[0].countryCode +
              contact.phoneNumbers[0].number
            : "not available"
        }.`,
      });
    }

    /* ================================
       🤖 AI CHAT
    ================================ */
    console.log("🤖 AI_CHAT start");

    let systemContext = `
You are an AI assistant.
The user is NOT logged in.
Instead of saying just hi greet with the name according the day timing.
Answer in a general and helpful way.
`;

    if (req.user?._id) {
      console.log("👤 Fetching logged-in user for AI context");

      const user = await User.findById(req.user._id).lean();

      if (user) {
        systemContext = `
You are an AI assistant.
Instead of saying just hi greet with the name according the day timing but not in all the messages.
The user IS logged in.

${buildUserContext(user)}
`;
      }
    }

    console.log("🤖 Calling OpenAI");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemContext },
        { role: "user", content: message },
      ],
      temperature: 0.4,
    });

    console.log("🤖 OpenAI response received");

    return res.status(200).json({
      success: true,
      reply: completion.choices[0].message.content,
    });
  } catch (error) {
    console.error("❌ ChatAgent ERROR");
    console.error("❌ Message:", error.message);
    console.error("❌ Stack:", error.stack);

    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
