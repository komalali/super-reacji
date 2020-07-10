import * as aws from "@pulumi/aws";
import { WebClient } from "@slack/web-api";
import { checkIfUserIsApproved, getMessagePermalink } from "./slack";

export async function handleEvent(event: any) {
    const dedupeTable = process.env.DEDUPE_TABLE_NAME || "";
    const ruleTable = process.env.RULE_TABLE_NAME || "";
    const tokenParamName = process.env.TOKEN_PARAM_NAME || "";

    if (!event.body) {
        return {
            statusCode: 400,
            body: "400 bad request",
        };
    }

    let jsonBody = Buffer.from(event.body, "base64").toString("utf8");
    const body = JSON.parse(jsonBody);
    console.log("body", body);

    if (body.challenge) {
        return {
            statusCode: 200,
            body: body.challenge,
        };
    }

    const {
        user,
        reaction: emoji,
        item: { channel, ts: timestamp },
    } = body?.event;
    if (!(user && emoji && channel && timestamp)) {
        return {
            statusCode: 400,
            body: "400 bad request",
        };
    }

    const messageId = `${emoji}-${channel}-${timestamp}`;
    const dynamo = new aws.sdk.DynamoDB();
    try {
        await dynamo
            .putItem({
                TableName: dedupeTable,
                Item: {
                    messageId: { S: messageId },
                    ttl: { N: String(Math.floor(Date.now() / 1000) + 600) },
                },
                ConditionExpression: "attribute_not_exists(messageId)",
            })
            .promise();
        console.log("First time seeing this message, adding to table.");
    } catch (err) {
        if (err.code != "ConditionalCheckFailedException") {
            await dynamo
                .deleteItem({
                    TableName: dedupeTable,
                    Key: {
                        messageId: { S: messageId },
                    },
                })
                .promise();
            throw err;
        }
        console.log("Message already exists, returning early.");
        return {
            statusCode: 200,
            body: "success",
        };
    }

    const ssm = new aws.sdk.SSM();
    const ssmResult = await ssm
        .getParameter({
            Name: tokenParamName,
            WithDecryption: true,
        })
        .promise();
    const slackSecret = ssmResult.Parameter?.Value;

    const web = new WebClient(slackSecret);
    const userIsPulumian = await checkIfUserIsApproved(web, user);

    if (userIsPulumian) {
        try {
            const response = (await dynamo
                .getItem({
                    TableName: ruleTable,
                    Key: {
                        emojiName: {
                            S: emoji,
                        },
                    },
                })
                .promise()) as any;
            const channelId = response.Item.channelId.S;

            const messageLinkResponse = await getMessagePermalink(
                web,
                channel,
                timestamp
            );
            console.log("messageLinkResponse", messageLinkResponse);
            console.log(channelId);

            if (messageLinkResponse.ok) {
                const response = await web.chat.postMessage({
                    text: String(messageLinkResponse.permalink),
                    channel: channelId,
                });
                console.log("chatResponse", response);
            }
        } catch (err) {
            if (err.code === "ResourceNotFoundException") {
                console.log("No rule for this emoji, exiting.");
                return {
                    statusCode: 200,
                    body: "success",
                };
            }
        }
    }

    return {
        statusCode: 200,
        body: "success",
    };
}

export async function handleNewRule(event: any) {
    const tableName = process.env.RULE_TABLE_NAME || "";
    const tokenParamName = process.env.TOKEN_PARAM_NAME || "";

    if (!event.body) {
        return {
            statusCode: 400,
            body: "400 bad request",
        };
    }

    let jsonBody = Buffer.from(event.body, "base64").toString("utf8");
    const body = JSON.parse(jsonBody);
    console.log("body", body);

    return {
        statusCode: 200,
        body: "success",
    };
}
