import AWS from "aws-sdk";

const lambda = new AWS.Lambda();

/* =========================
   HANDLER
========================= */
export const handler = async (event) => {
    console.log("====================================");
    console.log("[WS] Handler invoked");
    console.log("[WS] Timestamp:", new Date().toISOString());
    console.log("[WS] Raw event:", JSON.stringify(event, null, 2));

    const connectionId = event.requestContext?.connectionId;
    const routeKey = event.requestContext?.routeKey;
    const token = event.queryStringParameters?.token;

    console.log("[WS] Parsed values:");
    console.log("  - connectionId:", connectionId);
    console.log("  - routeKey:", routeKey);
    console.log("  - token exists:", Boolean(token));

    /* ---------- VALIDATION ---------- */
    if (!connectionId || !routeKey) {
        console.warn("[WS] Missing connectionId or routeKey");
        console.log("====================================");
        return { statusCode: 400 };
    }

    /* ---------- CONNECT ---------- */
    if (routeKey === "$connect") {
        console.log("[WS] $connect route triggered");

        if (!token) {
            console.warn("[WS] Missing token on $connect");
            console.log("====================================");
            return { statusCode: 401 };
        }

        const payload = {
            action: "connect",
            connectionId,
            token,
        };

        console.log("[WS] Invoking saveConnection-waba");
        console.log("[WS] Payload:", JSON.stringify(payload, null, 2));

        try {
            await lambda
                .invoke({
                    FunctionName: "saveConnection-waba",
                    InvocationType: "Event", // async
                    Payload: JSON.stringify(payload),
                })
                .promise();

            console.log("[WS] Lambda invoke successful (async)");
        } catch (err) {
            console.error("[WS] Lambda invoke failed", err);
        }

        console.log("[WS] $connect handler finished");
        console.log("====================================");
        return { statusCode: 200 };
    }

    /* ---------- DISCONNECT ---------- */
    if (routeKey === "$disconnect") {
        console.log("[WS] $disconnect route triggered");

        const payload = {
            action: "disconnect",
            connectionId,
        };

        console.log("[WS] Invoking saveConnection-waba");
        console.log("[WS] Payload:", JSON.stringify(payload, null, 2));

        try {
            await lambda
                .invoke({
                    FunctionName: "saveConnection-waba",
                    InvocationType: "Event", // async
                    Payload: JSON.stringify(payload),
                })
                .promise();

            console.log("[WS] Lambda invoke successful (async)");
        } catch (err) {
            console.error("[WS] Lambda invoke failed", err);
        }

        console.log("[WS] $disconnect handler finished");
        console.log("====================================");
        return { statusCode: 200 };
    }

    /* ---------- DEFAULT ---------- */
    console.log("[WS] Unhandled routeKey:", routeKey);
    console.log("[WS] Returning 200 by default");
    console.log("====================================");

    return { statusCode: 200 };
};
