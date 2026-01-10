const { gql } = require("apollo-server-express");

module.exports = gql`
  type WhatsAppWaba {
    isConnected: Boolean
    wabaId: String
    phoneNumberId: String
    phoneNumber: String
    businessAccountId: String
  }

  type Query {
    whatsappStatus: WhatsAppWaba
  }

  type Mutation {
    connectWhatsApp: String
    sendTextMessage(to: String!, text: String!): Boolean
    sendTemplateMessage(
      to: String!
      templateName: String!
      language: String
      components: [TemplateComponentInput]
    ): Boolean
  }

  input TemplateComponentInput {
    type: String
    parameters: [TemplateParameterInput]
  }

  input TemplateParameterInput {
    type: String
    text: String
  }
`;
