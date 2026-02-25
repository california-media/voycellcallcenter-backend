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

const Template_MEDIA_FOLDER_MAP = {
  image: "image",
  video: "video",
  document: "document",
};

//image | video | document
// format === "IMAGE" || format === "VIDEO" || format === "DOCUMENT"

async function uploadWhatsAppMediaToS3({
  userId,
  messageType,
  buffer,
  mimeType,
  originalName = "file"
}) {
  const ext = mimeType.split("/")[1] || "bin";
  const folder = MEDIA_FOLDER_MAP[messageType] || "others";

  const key = `users/${userId}/whatsapp/chats/${folder}/${originalName}_${Date.now()}.${ext}`;

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

async function uploadWhatsAppMediaTemplateToS3({
  userId,
  messageType,
  buffer,
  mimeType,
  originalName = "file"
}) {
  const ext = mimeType.split("/")[1] || "bin";
  const folder = Template_MEDIA_FOLDER_MAP[messageType] || "others";
  const key = `users/${userId}/whatsapp/template/${folder}/${originalName}_${Date.now()}.${ext}`;

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

async function uploadWhatsAppMediaProfileToS3({
  userId,
  buffer,
  mimeType,
  originalName = "profile"
}) {
  const ext = mimeType.split("/")[1] || "bin";

  const key = `users/${userId}/whatsapp/profile/${originalName}_${Date.now()}.${ext}`;

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


module.exports = { uploadWhatsAppMediaToS3, uploadWhatsAppMediaTemplateToS3, uploadWhatsAppMediaProfileToS3 };
