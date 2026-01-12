// const AWS = require("aws-sdk");
// const WsConnection = require("../models/wsConnection");

// const api = new AWS.ApiGatewayManagementApi({
//   endpoint: "o6iyrho5q6.execute-api.eu-north-1.amazonaws.com/production",
// });

// exports.sendToUser = async (userId, payload) => {
//   const connections = await WsConnection.find({ userId });

//   for (const conn of connections) {
//     try {
//       await api.postToConnection({
//         ConnectionId: conn.connectionId,
//         Data: JSON.stringify(payload),
//       }).promise();
//     } catch (err) {
//       // stale connection
//       if (err.statusCode === 410) {
//         await WsConnection.deleteOne({ connectionId: conn.connectionId });
//       }
//     }
//   }
// };
// // 

const {
    ApiGatewayManagementApiClient,
    PostToConnectionCommand,
} = require("@aws-sdk/client-apigatewaymanagementapi");

const WsConnection = require("../models/wsConnection");

const client = new ApiGatewayManagementApiClient({
    endpoint: "https://o6iyrho5q6.execute-api.eu-north-1.amazonaws.com/production",
});

exports.sendToUser = async (userId, payload) => {
    const connections = await WsConnection.find({ userId });
    console.log(connections);

    for (const conn of connections) {
        try {
            const command = new PostToConnectionCommand({
                ConnectionId: conn.connectionId,
                Data: Buffer.from(JSON.stringify(payload)),
            });

            await client.send(command);
        } catch (err) {
            if (err.$metadata?.httpStatusCode === 410) {
                await WsConnection.deleteOne({ connectionId: conn.connectionId });
            }
        }
    }
};
