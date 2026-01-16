import AWS from 'aws-sdk';
const lambda = new AWS.Lambda();

const apiGateway = new AWS.ApiGatewayManagementApi({
    endpoint: "o6iyrho5q6.execute-api.eu-north-1.amazonaws.com/production"
});

export const handler = async (event, context) => {
    // context.callbackWaitsForEmptyEventLoop = false;
    console.log("Lambda1 triggered");
    console.log("Event received:", JSON.stringify(event));

    // 1. Handle Internal Invocation (Webhook Broadcast)
    if (event.action === "broadcast") {
        const { connectionIds, messages } = event;

        console.log(`Broadcasting ${messages.length} messages`);

        const sendPromises = [];

        for (const msg of messages) {
            for (const connId of connectionIds) {
                sendPromises.push(
                    apiGateway.postToConnection({
                        ConnectionId: connId,
                        Data: JSON.stringify(msg)
                    }).promise().catch(err => {
                        if (err.statusCode === 410) {
                            console.log(`Stale connection ${connId}`);
                        } else {
                            console.error(err);
                        }
                    })
                );
            }
        }

        await Promise.all(sendPromises);
        return { statusCode: 200 };
    }

    const connectionId = event.requestContext?.connectionId;
    const routeKey = event.requestContext?.routeKey;
    const token = event.queryStringParameters?.token;

    if (!connectionId) {
        console.warn("no connectionId in event");
        return { statusCode: 400, body: "Invalid WebSocket Event" };
    }
    if (!routeKey) {
        console.warn("no routeKey in event");
        return { statusCode: 400, body: "Invalid WebSocket Event" };
    }

    if (routeKey === "$connect") {
        console.log("RouteKey is $connect");
        if (!token) {
            console.warn("No token provided");
            return { statusCode: 401, body: "Unauthorized" };
        }
        try {
            console.log(`invoking saveConnectionLambda for connectionId: ${connectionId}`);
            await lambda.invoke({
                FunctionName: "saveConnection-waba",
                InvocationType: "Event",
                Payload: JSON.stringify({
                    connectionId,
                    routeKey,
                    token
                })
            }).promise();

            console.log("saveConnectionLambda finished");
            console.log("Lambda1 returning 200 to WebSocket");
            return { statusCode: 200, body: "Connected" };

        } catch (err) {
            console.error("Lambda1 error:", err);
            return { statusCode: 500, body: "Internal Error" };
        }
    }
    if (routeKey === "$disconnect") {
        console.log("RouteKey is $disconnect");
        console.log("Lambda1 returning 200 to WebSocket for disconnect");
        console.log(`invoking saveConnectionLambda for connectionId: ${connectionId}`);
        await lambda.invoke({
            FunctionName: "saveConnection-waba",
            InvocationType: "Event",
            Payload: JSON.stringify({
                connectionId,
                routeKey
            })
        }).promise();
        return { statusCode: 200, body: "Disconnected" };
    }
    if (routeKey === "send") {
        console.log("RouteKey is send");

        const body = typeof event.body === "string"
            ? JSON.parse(event.body)
            : event.body;

        const message = body.message;

        if (!message) {
            return { statusCode: 400, body: "message is required" };
        }

        try {
            // 1. Get all connection IDs from saveConnection-waba
            console.log("Invoking saveConnection-waba to get all connections...");
            const lambdaResponse = await lambda.invoke({
                FunctionName: "saveConnection-waba",
                InvocationType: "RequestResponse", // RequestResponse is required to get the return value
                Payload: JSON.stringify({ action: "getAllConnections", connectionId, routeKey })
            }).promise();

            if (lambdaResponse.FunctionError) {
                console.error("Error from saveConnection-waba:", lambdaResponse.Payload);
                throw new Error("Failed to get connections");
            }

            const payload = JSON.parse(lambdaResponse.Payload);
            const connectionIds = payload.connectionIds || [];
            console.log(`Retrieved ${connectionIds.length} connections to broadcast to.`);

            // 2. Broadcast message to all connections
            const sendPromises = connectionIds.map(async (connId) => {
                try {
                    await apiGateway.postToConnection({
                        ConnectionId: connId,
                        Data: JSON.stringify({
                            from: "server",
                            message
                        })
                    }).promise();
                    // console.log(`Message sent to ${connId}`);
                } catch (err) {
                    if (err.statusCode === 410) {
                        console.log(`Found stale connection: ${connId}`);
                    } else {
                        console.error(`Failed to send to ${connId}:`, err);
                    }
                }
            });

            await Promise.all(sendPromises);
            console.log("Broadcast complete");

            return { statusCode: 200, body: "Message broadcasted" };
        } catch (err) {
            console.error("Broadcast error:", err);
            return { statusCode: 500, body: "Failed to broadcast message" };
        }
    }
};