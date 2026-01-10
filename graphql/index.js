const { ApolloServer } = require("apollo-server-express");
const typeDefs = require("./typeDefs");
const resolvers = require("./resolvers");

module.exports = async function initGraphQL(app) {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }) => ({
      user: req.user, // 👈 same auth
    }),
  });

  await server.start();
  server.applyMiddleware({ app, path: "/graphql" });
};
