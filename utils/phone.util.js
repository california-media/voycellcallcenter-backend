exports.normalizePhone = (rawPhone) => {
  if (!rawPhone) return null;

  const cleaned = rawPhone.replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+")) {
    const number = cleaned.slice(-10);
    const countryCode = cleaned.slice(1, cleaned.length - 10);
    return { countryCode, number };
  }

  // Default India
  return {
    countryCode: "91",
    number: cleaned.slice(-10),
  };
};
