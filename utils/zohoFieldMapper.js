exports.mapToZohoFields = (doc, status) => {
  return {
    First_Name: doc.firstname || "",
    Last_Name: doc.lastname || "",
    Phone: `${doc.phoneNumbers?.[0]?.countryCode}${doc.phoneNumbers?.[0]?.number}`,
    Lead_Status: status
  };
};
