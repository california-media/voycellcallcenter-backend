import AWS from "aws-sdk";
const lambda = new AWS.Lambda();

const apiGateway = new AWS.ApiGatewayManagementApi({
    endpoint: "https://nxdjbxsru4.execute-api.eu-north-1.amazonaws.com/production"
});

export const handler = async (event) => {
    console.log("incoming call EVENT:", JSON.stringify(event));

    /**
   * 🔥 CASE 1: Called from WEBHOOK (manual invoke)
   */
    if (event.action === "incomingcall") {
        console.log("===incoming call action called===");
        
        const { connections, payload } = event;

        console.log(connections);
        

        if (!connections || connections.length === 0) {
            console.log("No connections to notify");
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

                console.log("✅ Sent to:", connectionId);
            } catch (err) {
                // If connection is stale, AWS returns 410
                if (err.statusCode === 410) {
                    console.log("🗑️ Stale connection:", connectionId);
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
        console.log("[incomingcall] $connect route triggered");

        if (!token) {
            console.warn("[incomingcall] Missing token on $connect");
            console.log("====================================");
            return { statusCode: 401 };
        }

        const payload = {
            action: "connect",
            connectionId,
            token,
        };

        console.log("[incomingcall] Invoking saveConnection-waba");
        console.log("[incomingcall] Payload:", JSON.stringify(payload, null, 2));

        // 🔥 FIRE AND FORGET (NO WAIT)
        // const responce = 

        // console.log(responce);


        // return { statusCode: 200 };

        try {
            await lambda.invoke({
                FunctionName: "incomingcall-connection-save",
                InvocationType: "Event",
                Payload: JSON.stringify(payload)
            }).promise();

            console.log("[incomingcall] Lambda invoke successful (async)");
        } catch (err) {
            console.error("[incomingcall] Lambda invoke failed", err);
        }

        console.log("[incomingcall] $connect handler finished");
        console.log("====================================");
        return { statusCode: 200 };

    }

    if (routeKey === "$disconnect") {
        console.log("[incomingcall] $disconnect route triggered");

        const payload = {
            action: "disconnect",
            connectionId,
        };

        console.log("[incomingcall] Invoking saveConnection-waba");
        console.log("[incomingcall] Payload:", JSON.stringify(payload, null, 2));

        try {
            await lambda.invoke({
                FunctionName: "incomingcall-connection-save",
                InvocationType: "Event",
                Payload: JSON.stringify(payload)
            }).promise();

            console.log("[incomingcall] Lambda invoke successful (async)");
        } catch (err) {
            console.error("[incomingcall] Lambda invoke failed", err);
        }

        console.log("[incomingcall] $disconnect handler finished");
        console.log("====================================");
        return { statusCode: 200 };

    }

    return { statusCode: 200 };
};