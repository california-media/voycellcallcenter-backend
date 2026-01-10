const axios = require("axios");
const User = require("../models/userModel");
const { META_GRAPH_URL } = require("../config/whatsapp");
const {
  META_APP_ID,
  META_REDIRECT_URI,
} = process.env;

module.exports = {
  Query: {
    whatsappStatus: async (_, __, { user }) => {
      const dbUser = await User.findById(user._id);
      return dbUser.whatsappWaba;
    },
  },

  Mutation: {
    connectWhatsApp: async (_, __, { user }) => {
      return (
        `https://www.facebook.com/v23.0/dialog/oauth?` +
        `client_id=${META_APP_ID}` +
        `&redirect_uri=${META_REDIRECT_URI}` +
        `&scope=business_management,whatsapp_business_management,whatsapp_business_messaging` +
        `&response_type=code` +
        `&state=${user._id}`
      );
    },

    sendTextMessage: async (_, { to, text }, { user }) => {
      const dbUser = await User.findById(user._id);
      const { phoneNumberId, accessToken } = dbUser.whatsappWaba;

      await axios.post(
        `${META_GRAPH_URL}/${phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return true;
    },

    sendTemplateMessage: async (_, args, { user }) => {
      const dbUser = await User.findById(user._id);
      const { phoneNumberId, accessToken } = dbUser.whatsappWaba;

      await axios.post(
        `${META_GRAPH_URL}/${phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to: args.to,
          type: "template",
          template: {
            name: args.templateName,
            language: { code: args.language || "en_US" },
            components: args.components || [],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return true;
    },
  },
};
