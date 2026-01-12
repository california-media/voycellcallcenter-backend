const WsConnection = require("../models/wsConnection");

exports.handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  await WsConnection.deleteOne({ connectionId });

  return { statusCode: 200 };
};
