exports.getZohoDomainConfig = (dc) => {
  const map = {
    in: {
      accountsUrl: "https://accounts.zoho.in",
      apiBaseUrl: "https://www.zohoapis.in"
    },
    com: {
      accountsUrl: "https://accounts.zoho.com",
      apiBaseUrl: "https://www.zohoapis.com"
    },
    eu: {
      accountsUrl: "https://accounts.zoho.eu",
      apiBaseUrl: "https://www.zohoapis.eu"
    },
    au: {
      accountsUrl: "https://accounts.zoho.com.au",
      apiBaseUrl: "https://www.zohoapis.com.au"
    }
  };

  if (!map[dc]) throw new Error("Invalid Zoho DC");
  return map[dc];
};
