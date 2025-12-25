/* ================= GLOBAL DUPLICATE SET BUILDER ================= */
const buildGlobalDuplicateSets = async (userId) => {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error("User not found");

  const companyAdminId =
    user.role === "companyAdmin"
      ? user._id
      : user.createdByWhichCompanyAdmin || user._id;

  const companyUsers = await User.find({
    $or: [
      { _id: companyAdminId },
      { createdByWhichCompanyAdmin: companyAdminId },
    ],
  }).select("_id").lean();

  const userIds = companyUsers.map((u) => u._id);

  const [contacts, leads] = await Promise.all([
    Contact.find(
      { createdBy: { $in: userIds } },
      "phoneNumbers emailAddresses"
    ).lean(),
    Lead.find(
      { createdBy: { $in: userIds } },
      "phoneNumbers emailAddresses"
    ).lean(),
  ]);

  const existingPhones = new Set();
  const existingEmails = new Set();

  const addPhoneVariants = (p) => {
    if (!p?.number) return;
    const digits = p.number.replace(/\D/g, "");
    const cc = String(p.countryCode || "").replace(/\D/g, "");
    if (!digits) return;

    existingPhones.add(digits);
    if (cc) {
      existingPhones.add(`${cc}${digits}`);
      existingPhones.add(`+${cc}${digits}`);
    }
  };

  const addEmailVariants = (e) => {
    if (e) existingEmails.add(e.toLowerCase().trim());
  };

  [...contacts, ...leads].forEach((doc) => {
    doc.phoneNumbers?.forEach(addPhoneVariants);
    doc.emailAddresses?.forEach(addEmailVariants);
  });

  return { existingPhones, existingEmails, addPhoneVariants, addEmailVariants };
};

module.exports = { buildGlobalDuplicateSets };