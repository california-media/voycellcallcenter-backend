// const User = require("../models/userModel");
// const mongoose = require("mongoose");
// const axios = require("axios");
// const { META_GRAPH_URL } = require("../config/whatsapp");
// const WsConnection = require("../models/wsConnection");
// const WhatsAppMessage = require("../models/whatsappMessage");
// const WabaTemplate = require("../models/wabaTemplateModel");
// const Contact = require("../models/contactModel");
// const fs = require("fs");
// const FormData = require("form-data");
// const Lead = require("../models/leadModel");
// const { downloadMetaMedia } = require("../services/metaMedia");
// const { uploadWhatsAppMediaToS3, uploadWhatsAppMediaProfileToS3 } = require("../utils/uploadWhatsAppMedia");
// const { createCampaignSchedule } = require("../services/awsScheduler");
// const dotenv = require("dotenv");
// dotenv.config();

// exports.sendScheduledCampaignService = async ({
//   campaignId,
//   userId,
//   templateId,
//   params,
//   groupName,
// }) => {

//   console.log("Processing scheduled campaign:", campaignId);

//   const user = await User.findById(userId);
//   if (!user) throw new Error("User not found");

//   const { phoneNumberId, accessToken } = user.whatsappWaba;

//   /* ───────── TEMPLATE ───────── */
//   const template = await WabaTemplate.findById(templateId);
//   if (!template) throw new Error("Template not found");

//   /* ───────── REBUILD RECIPIENTS ───────── */
//   const contacts = await Contact.find({
//     createdBy: userId,
//     "tags.tag": { $in: groupName }
//   });

//   const leads = await Lead.find({
//     createdBy: userId,
//     "tags.tag": { $in: groupName }
//   });

//   let recipients = [
//     ...extractNumbersWithNames(contacts, "contact"),
//     ...extractNumbersWithNames(leads, "lead"),
//   ];

//   /* ───────── BUILD COMPONENTS ───────── */
//   const components = buildTemplateComponents(template, params);

//   const results = [];

//   for (const r of recipients) {

//     const resolvedParams = resolveDynamicParams(params, r);
//     const dynamicComponents =
//       applyDynamicParams(template, components, resolvedParams);

//     const payload = {
//       messaging_product: "whatsapp",
//       to: r.number,
//       type: "template",
//       template: {
//         name: template.name,
//         language: { code: template.language },
//         components: dynamicComponents,
//       },
//     };

//     try {
//       const { data } = await axios.post(
//         `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
//         payload,
//         {
//           headers: {
//             Authorization: `Bearer ${accessToken}`,
//             "Content-Type": "application/json",
//           },
//         }
//       );

//       results.push({ success: true });

//     } catch (err) {
//       console.error(err.response?.data);
//       results.push({ success: false });
//     }
//   }

//   /* ───────── UPDATE CAMPAIGN ───────── */
//   const campaign =
//     user.campaigns.find(
//       c => c.campaignId.toString() === campaignId
//     );

//   campaign.status = "completed";

//   await user.save();

//   console.log("✅ Scheduled campaign completed");
// };


const User = require("../models/userModel");
const mongoose = require("mongoose");
const axios = require("axios");
const WabaTemplate = require("../models/wabaTemplateModel");
const Contact = require("../models/contactModel");
const Lead = require("../models/leadModel");
const whatsappMessage = require("../models/whatsappMessage");
const { createCampaignSchedule } = require("../services/awsScheduler");
const dotenv = require("dotenv");
dotenv.config();

/* ──────────────────────────────────────────────
   🔧 HELPER — Extract Numbers With Names
────────────────────────────────────────────── */
const extractNumbersWithNames = (
    records,
    type = "contact"
) => {

    const data = [];

    records.forEach(r => {

        const firstName = r.firstname || "";
        const lastName = r.lastname || "";

        let name =
            `${firstName} ${lastName}`.trim();

        if (!name) {
            name = r.company || "Unknown";
        }

        r.phoneNumbers?.forEach(p => {

            if (p.number) {

                data.push({
                    number:
                        `${p.countryCode || ""}${p.number}`,
                    name,
                    firstName,
                    lastName,
                    company: r.company || ""
                });

            }

        });

    });

    return data;
};

/* ──────────────────────────────────────────────
   🔧 HELPER — Resolve Dynamic Params
────────────────────────────────────────────── */
const resolveDynamicParams = (
    params = {},
    recipient
) => {

    const resolved = { ...params };

    if (Array.isArray(params.body)) {

        resolved.body = params.body.map(p => {

            if (p === "{{first_name}}") {
                return recipient.firstName || "Customer";
            }

            if (p === "{{last_name}}") {
                return recipient.lastName || "";
            }

            if (p === "{{full_name}}") {
                return recipient.name || "Customer";
            }

            if (p === "{{company}}") {
                return recipient.company || "";
            }

            return p;
        });
    }

    return resolved;
};

/* ──────────────────────────────────────────────
   🔧 HELPER — Build Components
────────────────────────────────────────────── */
// const buildTemplateComponents = (
//     template,
//     params
// ) => {

//     const components = [];

//     const body =
//         template.components.find(
//             c => c.type === "BODY"
//         );

//     if (body) {

//         components.push({
//             type: "body",
//             parameters: (params.body || []).map(
//                 t => ({
//                     type: "text",
//                     text: t
//                 })
//             )
//         });

//     }

//     return components;
// };

const buildTemplateComponents = (
    template,
    params
) => {

    const components = [];

    /* ===== HEADER ===== */
    const header =
        template.components.find(
            c => c.type === "HEADER"
        );

    if (header?.format === "IMAGE" &&
        header.media?.s3Url) {

        components.push({
            type: "header",
            parameters: [{
                type: "image",
                image: {
                    link: header.media.s3Url
                }
            }]
        });
    }

    if(header?.format === "TEXT" && header.text){

        components.push({
            type: "header",
            parameters: [{
                type: "text",
                text: header.text
            }]
        });
    }

    if(header?.format === "VIDEO" && header.media?.s3Url){

        components.push({
            type: "header",
            parameters: [{
                type: "video",
                video: {
                    link: header.media.s3Url
                }
            }]
        });
    }

    if(header?.format === "DOCUMENT" && header.media?.s3Url) {

        components.push({
            type: "header",
            parameters: [{
                type: "document",
                document: {
                    link: header.media.s3Url,
                    filename: header.media.fileName || "document"
                }
            }]
        });
    }

    /* ===== BODY ===== */
    const body =
        template.components.find(
            c => c.type === "BODY"
        );

    if (body) {

        components.push({
            type: "body",
            parameters:
                (params.body || []).map(t => ({
                    type: "text",
                    text: t
                }))
        });
    }

    return components;
};



/* ──────────────────────────────────────────────
   🔧 HELPER — Apply Dynamic Params
────────────────────────────────────────────── */
const applyDynamicParams = (
    template,
    components,
    resolvedParams
) => {

    const dynamic =
        JSON.parse(JSON.stringify(components));

    const bodyIndex =
        dynamic.findIndex(c => c.type === "body");

    if (bodyIndex !== -1) {

        /* ===== NAMED PARAMS ===== */
        if (template.parameter_format === "named") {

            const namedExamples =
                template.components
                    .find(c => c.type === "BODY")
                    ?.example?.body_text_named_params || [];

            dynamic[bodyIndex].parameters =
                namedExamples.map((ex, i) => ({

                    type: "text",
                    parameter_name: ex.param_name, // ⭐ REQUIRED
                    text: resolvedParams.body?.[i] || ""

                }));
        }

        /* ===== POSITIONAL PARAMS ===== */
        else {

            dynamic[bodyIndex].parameters =
                (resolvedParams.body || []).map(text => ({
                    type: "text",
                    text
                }));
        }
    }

    return dynamic;
};


/* ──────────────────────────────────────────────
   🚀 MAIN SERVICE
────────────────────────────────────────────── */
exports.sendScheduledCampaignService =
    async ({
        campaignId,
        userId,
        templateId,
        params = {},
        groupName = [],
    }) => {

        console.log(
            "📨 Processing scheduled campaign:",
            campaignId
        );

        /* 1️⃣ USER */
        const user =
            await User.findById(userId);

        if (!user) {
            throw new Error("User not found");
        }

        const { phoneNumberId, accessToken } =
            user.whatsappWaba;

        /* 2️⃣ TEMPLATE */
        const template =
            await WabaTemplate.findById(
                templateId
            );

        if (!template) {
            throw new Error("Template not found");
        }

        /* 3️⃣ RECIPIENTS */
        const contacts =
            await Contact.find({
                createdBy: userId,
                "tags.tag": { $in: groupName }
            });

        const leads =
            await Lead.find({
                createdBy: userId,
                "tags.tag": { $in: groupName }
            });

        let recipients = [
            ...extractNumbersWithNames(
                contacts,
                "contact"
            ),
            ...extractNumbersWithNames(
                leads,
                "lead"
            ),
        ];

        console.log(
            "Recipients count:",
            recipients.length
        );

        /* 4️⃣ COMPONENTS */
        const baseComponents =
            buildTemplateComponents(
                template,
                params
            );

        const results = [];

        let fullName = ""; // To store recipient name for campaign update

        /* 5️⃣ SEND LOOP */
        // for (const r of recipients) {

        //     fullName = `${r.firstName} ${r.lastName}`.trim() || r.name || r.number;

        //     const resolvedParams =
        //         resolveDynamicParams(
        //             params,
        //             r
        //         );

        //     const dynamicComponents =
        //         applyDynamicParams(
        //             template,
        //             baseComponents,
        //             resolvedParams
        //         );

        //     const payload = {
        //         messaging_product: "whatsapp",
        //         to: r.number,
        //         type: "template",
        //         template: {
        //             name: template.name,
        //             language: {
        //                 code: template.language
        //             },
        //             components: dynamicComponents,
        //         },
        //     };

        //     try {

        //         const { data } = await axios.post(
        //             `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
        //             payload,
        //             {
        //                 headers: {
        //                     Authorization:
        //                         `Bearer ${accessToken}`,
        //                     "Content-Type":
        //                         "application/json",
        //                 },
        //             }
        //         );

        //         results.push({
        //             to: r.number,
        //             success: true,
        //             messageId: data.messages?.[0]?.id,
        //             chatName:
        //                 `${r.firstName} ${r.lastName}`.trim() ||
        //                 r.name ||
        //                 r.number
        //         });

        //     } catch (err) {

        //         console.error(
        //             "Send failed:",
        //             err.response?.data ||
        //             err.message
        //         );

        //         results.push({
        //             to: r.number,
        //             success: false
        //         });
        //     }
        // }

        /* 5️⃣ SEND LOOP */
        for (const r of recipients) {

            const fullName =
                `${r.firstName} ${r.lastName}`.trim() ||
                r.name ||
                r.number;

            const resolvedParams =
                resolveDynamicParams(params, r);

            const dynamicComponents =
                applyDynamicParams(
                    template,
                    baseComponents,
                    resolvedParams
                );

            const payload = {
                messaging_product: "whatsapp",
                to: r.number,
                type: "template",
                template: {
                    name: template.name,
                    language: {
                        code: template.language
                    },
                    components: dynamicComponents,
                },
            };

            try {

                /* ───────── SEND MESSAGE ───────── */
                const { data } = await axios.post(
                    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
                    payload,
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            "Content-Type": "application/json",
                        },
                    }
                );

                const metaId =
                    data.messages?.[0]?.id;

                /* ───────── STORE MESSAGE (FIX) ───────── */
                await whatsappMessage.create({

                    userId,
                    phoneNumberId,

                    conversationId: r.number,
                    direction: "outgoing",

                    from: phoneNumberId,
                    to: r.number,

                    senderName: fullName,

                    messageType: "template",

                    content: {
                        template: {
                            name: template.name,
                            language: template.language,
                            components: template.components,
                            params: resolvedParams
                        }
                    },

                    metaMessageId: metaId,
                    status: "sent",
                    messageTimestamp: new Date()

                });

                /* ───────── PUSH RESULT ───────── */
                results.push({
                    to: r.number,
                    success: true,
                    messageId: metaId,
                    chatName: fullName
                });

            } catch (err) {

                console.error(
                    "Send failed:",
                    err.response?.data ||
                    err.message
                );

                results.push({
                    to: r.number,
                    success: false
                });
            }
        }

        /* 6️⃣ UPDATE CAMPAIGN */
        const campaign =
            user.campaigns.find(
                c =>
                    c.campaignId.toString() ===
                    campaignId
            );

        if (campaign) {

            campaign.status = "completed";
            campaign.sentAt = new Date();
            campaign.messageRefs = results
                .filter(r => r.success)
                .map(r => ({
                    metaMessageId: r.messageId,
                    chatNumber: r.to,
                    chatName: r.chatName || r.to
                }));
            await user.save();
        }

        console.log(
            "✅ Scheduled campaign completed"
        );

        return {
            success: true,
            total: recipients.length,
            results,
        };
    };

