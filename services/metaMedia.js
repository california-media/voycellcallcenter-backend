const axios = require("axios");

async function downloadMetaMedia({ mediaId, accessToken }) {

  console.log("sevice file mediaid", mediaId);
  console.log("sevice file accessToken", accessToken);
  
  

  // 1️⃣ Get media URL
  const metaRes = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    {
      params: { access_token: accessToken }
    }
  );

  console.log("metaRes in download", metaRes);
  

  const mediaUrl = metaRes.data.url;

  console.log("mediaUrl in download", mediaUrl);
  

  // 2️⃣ Download binary
  const fileRes = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  console.log("fileRes in download",fileRes);
  

  return {
    buffer: Buffer.from(fileRes.data),
    mimeType: fileRes.headers["content-type"]
  };
}

module.exports = { downloadMetaMedia };
