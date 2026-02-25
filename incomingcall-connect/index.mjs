import AWS from "aws-sdk";
const lambda = new AWS.Lambda();

const apiGateway = new AWS.ApiGatewayManagementApi({
    endpoint: "https://nxdjbxsru4.execute-api.eu-north-1.amazonaws.com/production"
});

export const handler = async (event) => {
    /**
   * 🔥 CASE 1: Called from WEBHOOK (manual invoke)
   */
    if (event.action === "incomingcall") {
        const { connections, payload } = event;

        if (!connections || connections.length === 0) {
            return { statusCode: 200 };
        }

        const sendPromises = connections.map(async (connectionId) => {
            try {
                await apiGateway.postToConnection({
                    ConnectionId: connectionId,
                    Data: JSON.stringify({
                        type: "INCOMING_CALL",
                        data: payload,
                    }),
                }).promise();
            } catch (err) {
                // If connection is stale, AWS returns 410
                if (err.statusCode === 410) {
                } else {
                    console.error("❌ WS error:", err);
                }
            }
        });

        await Promise.all(sendPromises);
        return { statusCode: 200 };
    }


    const connectionId = event.requestContext?.connectionId;
    const routeKey = event.requestContext?.routeKey;
    const token = event.queryStringParameters?.token;

    if (!connectionId || !routeKey) {
        return { statusCode: 400 };
    }

    if (routeKey === "$connect") {
        if (!token) {
            return { statusCode: 401 };
        }

        const payload = {
            action: "connect",
            connectionId,
            token,
        };


        // return { statusCode: 200 };

        try {
            await lambda.invoke({
                FunctionName: "incomingcall-connection-save",
                InvocationType: "Event",
                Payload: JSON.stringify(payload)
            }).promise();

        } catch (err) {
            console.error("[incomingcall] Lambda invoke failed", err);
        }

        return { statusCode: 200 };

    }

    if (routeKey === "$disconnect") {
        const payload = {
            action: "disconnect",
            connectionId,
        };

        try {
            await lambda.invoke({
                FunctionName: "incomingcall-connection-save",
                InvocationType: "Event",
                Payload: JSON.stringify(payload)
            }).promise();
        } catch (err) {
            console.error("[incomingcall] Lambda invoke failed", err);
        }
        return { statusCode: 200 };

    }

    return { statusCode: 200 };
};