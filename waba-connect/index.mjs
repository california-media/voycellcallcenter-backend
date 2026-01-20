import AWS from "aws-sdk";
const lambda = new AWS.Lambda();

export const handler = async (event) => {
    console.log("WS EVENT:", JSON.stringify(event));

    const connectionId = event.requestContext?.connectionId;
    const routeKey = event.requestContext?.routeKey;
    const token = event.queryStringParameters?.token;

    if (!connectionId || !routeKey) {
        return { statusCode: 400 };
    }

    if (routeKey === "$connect") {
        if (!token) return { statusCode: 401 };
        console.log("connect call");

        // 🔥 FIRE AND FORGET (NO WAIT)
        lambda.invoke({
            FunctionName: "saveConnection-waba",
            InvocationType: "Event",
            Payload: JSON.stringify({
                action: "connect",
                connectionId,
                token
            })
        }).promise();

        return { statusCode: 200 };
    }

    if (routeKey === "$disconnect") {
        console.log("disconnect call ");

        lambda.invoke({
            FunctionName: "saveConnection-waba",
            InvocationType: "Event",
            Payload: JSON.stringify({
                action: "disconnect",
                connectionId
            })
        }).promise();

        return { statusCode: 200 };
    }

    return { statusCode: 200 };
};