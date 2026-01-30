const path = require("path");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const s3 = require("./s3");

const MEDIA_FOLDER_MAP = {
  image: "images",
  video: "videos",
  audio: "audio",
  document: "documents",
  sticker: "stickers"
};

async function uploadWhatsAppMediaToS3({
  userId,
  messageType,
  buffer,
  mimeType,
  originalName = "file"
}) {
  const ext = mimeType.split("/")[1] || "bin";
  const folder = MEDIA_FOLDER_MAP[messageType] || "others";

  const key = `users/${userId}/whatsapp/${folder}/${originalName}_${Date.now()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME_WABA,
      Key: key,
      Body: buffer,
      ContentType: mimeType
    })
  );

  return `https://${process.env.AWS_BUCKET_NAME_WABA}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

module.exports = { uploadWhatsAppMediaToS3 };
