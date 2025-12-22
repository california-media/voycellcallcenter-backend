const axios = require("axios");
const { getValidZohoToken } = require("./zohoTokenService");

exports.pushContactToZoho = async (contact, connection) => {
  const token = await getValidZohoToken(connection);

  const payload = {
    data: [{
      First_Name: contact.firstname,
      Last_Name: contact.lastname,
      Email: contact.emailAddresses?.[0],
      Phone: contact.phoneNumbers?.[0]?.number,
    }]
  };

  const url = contact.zoho?.recordId
    ? `${connection.apiDomain}/crm/v2/Contacts/${contact.zoho.recordId}`
    : `${connection.apiDomain}/crm/v2/Contacts`;

  const method = contact.zoho?.recordId ? "put" : "post";

  const { data } = await axios({
    method,
    url,
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    data: payload,
  });

  if (!contact.zoho?.recordId) {
    contact.zoho = { recordId: data.data[0].details.id };
    await contact.save();
  }
};
