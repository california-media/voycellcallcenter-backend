const { ApolloServer } = require("apollo-server-express");
const typeDefs = require("../graphql/typeDefs");
const resolvers = require("../graphql/resolvers");

module.exports = async function initGraphQL(app, checkForAuthentication) {
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: ({ req }) => ({
      user: req.user,
    }),
  });

  await server.start();

  // Use applyMiddleware for apollo-server-express v3
  server.applyMiddleware({ 
    app, 
    path: "/graphql",
    // To apply your auth middleware specifically to graphql:
    cors: true 
  });
  
  // If you want custom middleware specifically before graphql:
  app.use("/graphql", checkForAuthentication()); 
  
  console.log(`🚀 GraphQL ready at ${server.graphqlPath}`);
};
