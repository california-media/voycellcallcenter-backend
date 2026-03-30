// // const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

// // const s3 = new S3Client({
// //   region: process.env.AWS_REGION,
// // });

// // let cachedConfig = null;

// // // helper: convert S3 stream to string
// // const streamToString = (stream) =>
// //   new Promise((resolve, reject) => {
// //     const chunks = [];
// //     stream.on("data", (chunk) => chunks.push(chunk));
// //     stream.on("error", reject);
// //     stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
// //   });

// // // async fetch function
// // const fetchConfigFromS3 = async () => {
// //   if (cachedConfig) return cachedConfig;

// //   const command = new GetObjectCommand({
// //     Bucket: "voycell-config",
// //     Key: "config.json",
// //   });

// //   const response = await s3.send(command);
// //   const bodyContents = await streamToString(response.Body);
// //   cachedConfig = JSON.parse(bodyContents);

// //   return cachedConfig;
// // };

// // // Immediately start async fetch at startup
// // const loadConfigPromise = fetchConfigFromS3()
// //   .then(() => console.log("✅ CONFIG FROM S3 LOADED:", cachedConfig))
// //   .catch((err) =>
// //     console.error("❌ FAILED TO LOAD CONFIG FROM S3:", err)
// //   );

// // // Synchronous getter (only works after first fetch)
// // const getConfig = () => {
// //   if (!cachedConfig) {
// //     throw new Error(
// //       "Config not loaded yet! Make sure getConfig() is called after initial load."
// //     );
// //   }
// //   return cachedConfig;
// // };


// // working code is start form here 

// // module.exports = { getConfig, fetchConfigFromS3, loadConfigPromise };
// const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

// let cachedConfig = null;

// const streamToString = (stream) =>
//   new Promise((resolve, reject) => {
//     const chunks = [];
//     stream.on("data", (chunk) => chunks.push(chunk));
//     stream.on("error", reject);
//     stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
//   });

// const fetchConfigFromS3 = async () => {
//   if (cachedConfig) return cachedConfig;

//   const IS_AWS = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

//   if (IS_AWS) {
//     // ✅ On Lambda — use S3 SDK (has IAM role, no credentials needed)
//     const s3 = new S3Client({ region: process.env.AWS_REGION });
//     const command = new GetObjectCommand({
//       Bucket: "voycell-config",
//       Key: "config.json",
//     });
//     const response = await s3.send(command);
//     const bodyContents = await streamToString(response.Body);
//     cachedConfig = JSON.parse(bodyContents);
//   } else {
//     // ✅ On Local — use public HTTP (no credentials needed)
//     const response = await fetch("https://voycell-config.s3.eu-north-1.amazonaws.com/config.json");
//     if (!response.ok) {
//       throw new Error(`Failed to fetch config: ${response.statusText}`);
//     }
//     cachedConfig = await response.json();
//   }

//   return cachedConfig;
// };

// const loadConfigPromise = fetchConfigFromS3()
//   .then(() => console.log("✅ CONFIG FROM S3 LOADED:", cachedConfig))
//   .catch((err) => console.error("❌ FAILED TO LOAD CONFIG FROM S3:", err));

// const getConfig = () => {
//   if (!cachedConfig) {
//     throw new Error("Config not loaded yet! Make sure getConfig() is called after initial load.");
//   }
//   return cachedConfig;
// };

// module.exports = { getConfig, fetchConfigFromS3, loadConfigPromise };