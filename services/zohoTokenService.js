// services/zohoTokenService.js
const axios = require("axios");

exports.getValidZohoToken = async (connection) => {
  if (connection.expiresAt && Date.now() < connection.expiresAt.getTime()) {
    return connection.accessToken;
  }

  const { data } = await axios.post(
    `${connection.accountsDomain}/oauth/v2/token`,
    null,
    {
      params: {
        grant_type: "refresh_token",
        refresh_token: connection.refreshToken,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET
      }
    }
  );

  connection.accessToken = data.access_token;
  connection.expiresAt = new Date(Date.now() + data.expires_in * 1000);
  await connection.save();

  return connection.accessToken;
};
