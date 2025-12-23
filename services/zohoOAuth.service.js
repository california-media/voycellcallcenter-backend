const axios = require("axios");
const qs = require("querystring");
const https = require("https");
const agent = new https.Agent({ keepAlive: false });

exports.getAuthURL = ({ accountsUrl, redirectUri, state }) => {
  const scope = [
    "ZohoCRM.modules.ALL",
    "ZohoCRM.users.READ",
    "ZohoCRM.settings.ALL",
    "ZohoCRM.modules.contacts.ALL",
    "ZohoCRM.modules.leads.ALL",
    "ZohoCRM.modules.tasks.ALL",
    "ZohoCRM.modules.events.ALL",
    
  ].join(",");

  return `${accountsUrl}/oauth/v2/auth?` + qs.stringify({
    scope,
    client_id: process.env.ZOHO_CLIENT_ID,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    redirect_uri: redirectUri,
    state // ✅ THIS WAS MISSING
  });
};

// exports.getTokens = async ({ code, accountsUrl, redirectUri }) => {
//   console.log("Token Request URL:", `${accountsUrl}/oauth/v2/token`);
//   const res = await axios.post(
//     `${accountsUrl}/oauth/v2/token`,
//     qs.stringify({
//       grant_type: "authorization_code",
//       client_id: process.env.ZOHO_CLIENT_ID,
//       client_secret: process.env.ZOHO_CLIENT_SECRET,
//       redirect_uri: redirectUri,
//       code
//     })
//   );
//   return res.data;
// };

exports.getTokens = async ({ code, accountsUrl, redirectUri }) => {
  return axios.post(
    `${accountsUrl}/oauth/v2/token`,
    qs.stringify({
      grant_type: "authorization_code",
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code
    }),
    {
      timeout: 15000,
      httpsAgent: agent,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  ).then(res => res.data);
};

exports.refreshToken = async ({ refreshToken, accountsUrl }) => {
  const res = await axios.post(
    `${accountsUrl}/oauth/v2/token`,
    qs.stringify({
      refresh_token: refreshToken,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: "refresh_token"
    })
  );
  return res.data.access_token;
};
